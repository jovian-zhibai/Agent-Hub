import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// Fallback provider seed data
// Used when the providers table is empty
// ──────────────────────────────────────────────

const FALLBACK_PROVIDERS = [
  {
    name: "openai",
    displayName: "OpenAI",
    supportedProtocols: ["openai"],
    baseUrls: { openai: "https://api.openai.com/v1" },
  },
  {
    name: "anthropic",
    displayName: "Anthropic",
    supportedProtocols: ["anthropic"],
    baseUrls: { anthropic: "https://api.anthropic.com/v1" },
  },
  {
    name: "deepseek",
    displayName: "DeepSeek",
    supportedProtocols: ["openai", "anthropic"],
    baseUrls: {
      openai: "https://api.deepseek.com/v1",
      anthropic: "https://api.deepseek.com/v1",
    },
  },
  {
    name: "google",
    displayName: "Google",
    supportedProtocols: ["openai"],
    baseUrls: {
      openai: "https://generativelanguage.googleapis.com/v1beta/openai",
    },
  },
];

// ──────────────────────────────────────────────
// GET /api/v1/providers
// List all providers. Uses DB data if available,
// falls back to hardcoded seed data if empty.
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await getAuthUser(request);
    // ── Attempt to read from DB ────────────────
    const dbProviders = await prisma.provider.findMany({
      orderBy: { createdAt: "asc" },
    });

    if (dbProviders.length > 0) {
      const providers = dbProviders.map((p) => ({
        id: p.id,
        name: p.name,
        displayName: p.displayName,
        supportedProtocols: p.supportedProtocols as string[],
        baseUrls: p.baseUrls as Record<string, string>,
      }));

      return NextResponse.json({ providers }, { status: 200 });
    }

    // ── Fallback: return seed data ─────────────
    return NextResponse.json({ providers: FALLBACK_PROVIDERS }, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[providers] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}