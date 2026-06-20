import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import { decryptKey } from "@/lib/crypto";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface DiscoveredModel {
  modelName: string;
  displayName: string;
  pricingInput: number | null;
  pricingOutput: number | null;
  pricingSource: string;
  protocol: string;
}

interface DiscoverModelsResponse {
  models: DiscoveredModel[];
  matched: number;
  unmatched: number;
  total: number;
}

interface PricingMatch {
  input: number;
  output: number;
}

// ──────────────────────────────────────────────
// POST /api/v1/keys/:id/discover-models
// Discover available models for a key by probing
// the provider API and matching pricing from
// LiteLLM / OpenRouter / local DB.
// ──────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id } = await params;

    // ── Step 1: Verify key and load provider ──
    const key = await prisma.key.findUnique({
      where: { id },
      select: {
        accountId: true,
        protocol: true,
        keyEncrypted: true,
        providerId: true,
      },
    });

    if (!key) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Key not found" },
        { status: 404 }
      );
    }

    if (key.accountId !== user.id) {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Access denied" },
        { status: 403 }
      );
    }

    const provider = await prisma.provider.findUnique({
      where: { id: key.providerId },
      select: {
        name: true,
        supportedProtocols: true,
        baseUrls: true,
      },
    });

    if (!provider) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Provider not found" },
        { status: 404 }
      );
    }

    // ── Decrypt API key with AES-256-GCM ────────
    const apiKey = decryptKey(key.keyEncrypted);

    const baseUrls = provider.baseUrls as Record<string, string>;
    const baseUrl = baseUrls[key.protocol] ?? null;

    // ── Step 2: Fetch model list ──────────────
    let modelNames: string[];

    if (provider.name === "anthropic") {
      // Anthropic has no /v1/models endpoint — use community list
      modelNames = getCommunityModels("anthropic");
    } else {
      modelNames = await fetchModelsFromProvider(baseUrl, apiKey);
      // Fallback to community list if provider API is unreachable
      if (modelNames.length === 0) {
        const fallback = getCommunityModels(provider.name);
        if (fallback.length > 0) {
          console.info(
            `[discover-models] Provider API unreachable for "${provider.name}", using community fallback (${fallback.length} models)`
          );
          modelNames = fallback;
        }
      }
    }

    if (modelNames.length === 0) {
      return NextResponse.json(
        {
          models: [],
          matched: 0,
          unmatched: 0,
          total: 0,
          message: "No models discovered — provider API returned no results",
        },
        { status: 200 }
      );
    }

    // ── Step 3-4: Match pricing & upsert models
    const results: DiscoveredModel[] = [];
    let matched = 0;
    let unmatched = 0;

    for (const rawName of modelNames) {
      const normalized = normalizeModelName(rawName);
      const protocol = key.protocol;

      // 3a: Try database match
      let pricing: PricingMatch | null = await matchFromDatabase(
        provider.name,
        normalized
      );

      // 3b: Try LiteLLM
      if (!pricing) {
        pricing = await matchFromLiteLLM(normalized);
      }

      // 3c: Try OpenRouter
      if (!pricing) {
        pricing = await matchFromOpenRouter(normalized);
      }

      // 3d: Determine pricingSource
      const pricingSource = pricing
        ? "litellm"
        : "unknown";

      // ── Upsert to models table ───────────────
      const displayName = toDisplayName(rawName);
      const pricingInput = pricing?.input ?? 0;
      const pricingOutput = pricing?.output ?? 0;

      await prisma.model.upsert({
        where: {
          providerId_modelName: {
            providerId: key.providerId,
            modelName: normalized,
          },
        },
        create: {
          providerId: key.providerId,
          defaultProtocol: protocol,
          supportedProtocols: [protocol],
          modelName: normalized,
          displayName,
          pricingInput,
          pricingOutput,
          pricingAsOf: pricing ? new Date() : null,
          pricingSource,
          isActive: true,
        },
        update: {
          displayName,
          pricingInput,
          pricingOutput,
          pricingAsOf: pricing ? new Date() : null,
          pricingSource,
          isActive: true,
        },
      });

      if (pricing) {
        matched++;
      } else {
        unmatched++;
      }

      results.push({
        modelName: normalized,
        displayName,
        pricingInput: pricing?.input ?? null,
        pricingOutput: pricing?.output ?? null,
        pricingSource,
        protocol,
      });
    }

    const response: DiscoverModelsResponse = {
      models: results,
      matched,
      unmatched,
      total: results.length,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR",
          message: error.message,
        },
        { status: error.statusCode }
      );
    }

    console.error("[keys/id/discover-models] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────
// Model name normalization
// ──────────────────────────────────────────────

/**
 * Normalize a model name by stripping date/version suffixes,
 * lowercasing, and trimming whitespace.
 *
 * Examples:
 *   "claude-sonnet-4-20250514" → "claude-sonnet-4"
 *   "gpt-4o-2025-04-09"       → "gpt-4o"
 *   "deepseek-v4-flash-0619"  → "deepseek-v4-flash"
 */
function normalizeModelName(name: string): string {
  let normalized = name.toLowerCase().trim();

  // Remove date suffixes like -20250514 (8 consecutive digits)
  normalized = normalized.replace(/-\d{8}$/, "");

  // Remove date suffixes like -2025-04-09
  normalized = normalized.replace(/-\d{4}-\d{2}-\d{2}$/, "");

  // Remove short numeric suffixes like -0619 (4-6 digits after dash)
  normalized = normalized.replace(/-\d{4,6}$/, "");

  return normalized;
}

/**
 * Generate a human-readable display name from a model identifier.
 */
function toDisplayName(modelName: string): string {
  return modelName
    .split(/[-_]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ──────────────────────────────────────────────
// HTTP helper with timeout
// ──────────────────────────────────────────────

/**
 * Fetch a URL with a 5-second timeout.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

// ──────────────────────────────────────────────
// Strategy A: Fetch models from provider API
// ──────────────────────────────────────────────

/**
 * Fetch model names from a provider's GET /v1/models endpoint.
 * Returns an empty array on any error (non-fatal).
 */
async function fetchModelsFromProvider(
  baseUrl: string | null,
  apiKey: string
): Promise<string[]> {
  if (!baseUrl) {
    console.warn("[discover-models] No baseUrl available for provider");
    return [];
  }

  try {
    const url = `${baseUrl.replace(/\/$/, "")}/models`;
    const resp = await fetchWithTimeout(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!resp.ok) {
      console.warn(
        `[discover-models] Provider API returned ${resp.status} for ${url}`
      );
      return [];
    }

    const body = (await resp.json()) as {
      data?: Array<{ id: string }>;
    };

    if (!body.data || !Array.isArray(body.data)) {
      return [];
    }

    return body.data
      .map((m) => m.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch (error) {
    console.warn("[discover-models] Failed to fetch models from provider:", error);
    return [];
  }
}

// ──────────────────────────────────────────────
// Strategy B: Community-sourced model lists
// Used when provider API is unreachable (mock keys,
// offline testing, or providers without a /v1/models
// endpoint like Anthropic).
// ──────────────────────────────────────────────

const COMMUNITY_MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-sonnet-4",
    "claude-sonnet-4-20250514",
    "claude-max-3-opus",
    "claude-max-3-sonnet",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
    "claude-3-haiku-20240307",
  ],
  openai: [
    "gpt-4o",
    "gpt-4o-2025-04-09",
    "gpt-4o-mini",
    "gpt-4o-mini-2025-04-09",
    "gpt-4-1",
    "gpt-4-1-2025-04-09",
    "gpt-4-1-mini",
    "gpt-4-1-mini-2025-04-09",
    "gpt-4-1-nano",
    "gpt-4-1-nano-2025-04-09",
    "gpt-4-turbo",
    "gpt-4-turbo-2024-04-09",
    "gpt-4",
    "gpt-4-32k",
    "gpt-3-5-turbo",
    "o3",
    "o3-mini",
    "o3-mini-2025-01-31",
    "o1",
    "o1-2024-12-17",
    "o1-mini",
    "o1-mini-2024-09-12",
    "o1-preview",
    "o1-preview-2024-09-12",
    "dall-e-3",
    "dall-e-2",
    "whisper-1",
    "tts-1",
    "tts-1-hd",
    "text-embedding-3-large",
    "text-embedding-3-small",
    "text-embedding-ada-002",
    "moderation-latest",
    "moderation-stable",
  ],
  deepseek: [
    "deepseek-v4-flash",
    "deepseek-v4-flash-0619",
    "deepseek-v4",
    "deepseek-v4-0619",
    "deepseek-chat",
    "deepseek-reasoner",
    "deepseek-coder",
    "deepseek-r1",
    "deepseek-r1-0528",
  ],
};

/**
 * Return the community-sourced model list for a given provider name.
 * Falls back to an empty array for unknown providers.
 */
function getCommunityModels(providerName: string): string[] {
  const models = COMMUNITY_MODELS[providerName];
  if (models) {
    return [...models];
  }
  console.warn(`[discover-models] No community model list for provider: ${providerName}`);
  return [];
}

// ──────────────────────────────────────────────
// Pricing data sources
// ──────────────────────────────────────────────

/**
 * Try matching pricing from the local models database.
 */
async function matchFromDatabase(
  providerName: string,
  normalizedName: string
): Promise<PricingMatch | null> {
  try {
    const existing = await prisma.model.findFirst({
      where: {
        modelName: normalizedName,
        provider: { name: providerName },
        pricingSource: { not: "unknown" },
        pricingInput: { gt: 0 },
      },
      select: {
        pricingInput: true,
        pricingOutput: true,
      },
    });

    if (!existing) return null;

    return {
      input: Number(existing.pricingInput),
      output: Number(existing.pricingOutput),
    };
  } catch {
    return null;
  }
}

/**
 * Try matching pricing from the LiteLLM pricing JSON.
 * LiteLLM returns cost per token; we convert to cost per 1M tokens.
 */
async function matchFromLiteLLM(
  modelName: string
): Promise<PricingMatch | null> {
  try {
    const resp = await fetchWithTimeout(
      "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
    );

    if (!resp.ok) return null;

    const data = (await resp.json()) as Record<
      string,
      {
        input_cost_per_token?: number;
        output_cost_per_token?: number;
      }
    >;

    // Exact match first
    if (data[modelName]) {
      const entry = data[modelName];
      if (
        entry.input_cost_per_token != null &&
        entry.output_cost_per_token != null
      ) {
        return {
          input: entry.input_cost_per_token * 1_000_000,
          output: entry.output_cost_per_token * 1_000_000,
        };
      }
    }

    // Fuzzy match: look for a key containing or contained by modelName
    for (const [key, entry] of Object.entries(data)) {
      if (
        entry.input_cost_per_token != null &&
        entry.output_cost_per_token != null
      ) {
        if (key.includes(modelName) || modelName.includes(key)) {
          return {
            input: entry.input_cost_per_token * 1_000_000,
            output: entry.output_cost_per_token * 1_000_000,
          };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Try matching pricing from the OpenRouter models API.
 * OpenRouter returns cost per token; we convert to cost per 1M tokens.
 */
async function matchFromOpenRouter(
  modelName: string
): Promise<PricingMatch | null> {
  try {
    const resp = await fetchWithTimeout(
      "https://openrouter.ai/api/v1/models"
    );

    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      data: Array<{
        id: string;
        pricing: { prompt: string; completion: string };
      }>;
    };

    if (!data.data || !Array.isArray(data.data)) return null;

    for (const model of data.data) {
      const normalized = model.id.toLowerCase();
      if (normalized.includes(modelName) || modelName.includes(normalized)) {
        const prompt = parseFloat(model.pricing.prompt);
        const completion = parseFloat(model.pricing.completion);
        if (!isNaN(prompt) && !isNaN(completion)) {
          return {
            input: prompt * 1_000_000,
            output: completion * 1_000_000,
          };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}
