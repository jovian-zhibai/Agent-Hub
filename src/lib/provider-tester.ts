// ──────────────────────────────────────────────
// Provider Tester — Test API key validity
// ──────────────────────────────────────────────

import { URL } from "url";
import net from "net";
import { decryptKey } from "./crypto";

function isPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname;

    // Only allow http/https
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return true;
    }

    // Block known metadata endpoints
    const blockedHosts = ["metadata.google.internal", "metadata.aws.internal", "169.254.169.254"];
    if (blockedHosts.includes(hostname)) {
      return true;
    }

    // Parse IP address — handle IPv4, IPv6, and shorthand notations
    // Node's URL already normalizes IPv6 brackets
    const isIP = net.isIP(hostname);
    if (isIP === 4) {
      return isPrivateIPv4(hostname);
    }
    if (isIP === 6) {
      return isPrivateIPv6(hostname);
    }

    // Not an IP — it's a hostname. Block localhost variants.
    if (hostname === "localhost") {
      return true;
    }

    // For hostnames, we can't fully prevent DNS rebinding,
    // but we block obvious internal patterns
    return false;
  } catch {
    return true;
  }
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return true;

  const a = parts[0]!;
  const b = parts[1]!;

  // 0.0.0.0/8
  if (a === 0) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 127.0.0.0/8 (entire loopback range)
  if (a === 127) return true;
  // 169.254.0.0/16 (link-local / metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 (CGNAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // ::1 loopback
  if (lower === "::1") return true;
  // fc00::/7 (ULA)
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // fe80::/10 (link-local)
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // ::ffff: mapped IPv4
  if (lower.startsWith("::ffff:")) {
    const ipv4 = lower.slice("::ffff:".length);
    if (net.isIPv4(ipv4)) return isPrivateIPv4(ipv4);
  }
  return false;
}

export interface TestResult {
  success: boolean;
  health: "normal" | "warning" | "critical" | "invalid";
  message: string;
  details?: {
    models?: string[];
    rateLimit?: {
      remaining?: number;
      reset?: string;
    };
    balance?: number;
    error?: string;
  };
}

interface ModelResponse {
  data?: Array<{ id: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

interface ErrorResponse {
  error?: {
    message?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Test an API key against its provider.
 * 
 * @param encryptedKey - Encrypted API key
 * @param provider - Provider name (openai, anthropic, etc.)
 * @param protocol - API protocol (openai, anthropic, etc.)
 * @param baseUrl - Optional custom base URL
 */
export async function testProviderKey(
  encryptedKey: string,
  provider: string,
  protocol: string,
  baseUrl?: string
): Promise<TestResult> {
  if (baseUrl && isPrivateUrl(baseUrl)) {
    return {
      success: false,
      health: "invalid",
      message: "Blocked: base URL points to a private or internal address",
    };
  }
  try {
    // Decrypt the key
    const apiKey = decryptKey(encryptedKey);

    // Route to appropriate tester based on protocol
    switch (protocol.toLowerCase()) {
      case "openai":
        return await testOpenAIKey(apiKey, baseUrl);
      case "anthropic":
        return await testAnthropicKey(apiKey, baseUrl);
      case "openrouter":
        return await testOpenRouterKey(apiKey, baseUrl);
      default:
        return await testGenericOpenAICompatible(apiKey, baseUrl || "https://api.openai.com");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      health: "invalid",
      message: `Test failed: ${message}`,
      details: { error: message },
    };
  }
}

/**
 * Test OpenAI API key by calling /v1/models endpoint.
 */
async function testOpenAIKey(apiKey: string, baseUrl?: string): Promise<TestResult> {
  const url = `${baseUrl || "https://api.openai.com"}/v1/models`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    // Parse rate limit headers
    const remainingHeader = response.headers.get("x-ratelimit-remaining");
    const resetHeader = response.headers.get("x-ratelimit-reset");
    
    const rateLimit = {
      remaining: remainingHeader ? parseInt(remainingHeader) : undefined,
      reset: resetHeader || undefined,
    };

    if (response.ok) {
      const data = await response.json() as ModelResponse;
      const models = data.data?.map((m) => m.id) || [];

      return {
        success: true,
        health: "normal",
        message: `Connected successfully. Found ${models.length} models.`,
        details: {
          models: models.slice(0, 10), // First 10 models
          rateLimit,
        },
      };
    }

    // Handle error responses
    const errorData = await response.json().catch(() => ({})) as ErrorResponse;
    const errorMessage = errorData.error?.message || response.statusText;

    if (response.status === 401) {
      return {
        success: false,
        health: "invalid",
        message: "Invalid API key",
        details: { error: errorMessage },
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        health: "critical",
        message: "Rate limit exceeded",
        details: { error: errorMessage, rateLimit },
      };
    }

    return {
      success: false,
      health: "warning",
      message: `API error: ${errorMessage}`,
      details: { error: errorMessage },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        health: "warning",
        message: "Request timeout",
        details: { error: "Connection timed out after 10 seconds" },
      };
    }

    throw error;
  }
}

/**
 * Test Anthropic API key by calling /v1/models endpoint.
 */
async function testAnthropicKey(apiKey: string, baseUrl?: string): Promise<TestResult> {
  const url = `${baseUrl || "https://api.anthropic.com"}/v1/models`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json() as ModelResponse;
      const models = data.data?.map((m) => m.id) || [];

      return {
        success: true,
        health: "normal",
        message: `Connected successfully. Found ${models.length} models.`,
        details: { models: models.slice(0, 10) },
      };
    }

    const errorData = await response.json().catch(() => ({})) as ErrorResponse;
    const errorMessage = errorData.error?.message || response.statusText;

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        health: "invalid",
        message: "Invalid API key",
        details: { error: errorMessage },
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        health: "critical",
        message: "Rate limit exceeded",
        details: { error: errorMessage },
      };
    }

    return {
      success: false,
      health: "warning",
      message: `API error: ${errorMessage}`,
      details: { error: errorMessage },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        health: "warning",
        message: "Request timeout",
        details: { error: "Connection timed out after 10 seconds" },
      };
    }

    throw error;
  }
}

/**
 * Test OpenRouter API key.
 */
async function testOpenRouterKey(apiKey: string, baseUrl?: string): Promise<TestResult> {
  const url = `${baseUrl || "https://openrouter.ai"}/api/v1/models`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://agent-hub.dev",
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json() as ModelResponse;
      const models = data.data?.map((m) => m.id) || [];

      return {
        success: true,
        health: "normal",
        message: `Connected successfully. Found ${models.length} models.`,
        details: { models: models.slice(0, 10) },
      };
    }

    const errorData = await response.json().catch(() => ({})) as ErrorResponse;
    const errorMessage = errorData.error?.message || response.statusText;

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        health: "invalid",
        message: "Invalid API key",
        details: { error: errorMessage },
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        health: "critical",
        message: "Rate limit exceeded",
        details: { error: errorMessage },
      };
    }

    return {
      success: false,
      health: "warning",
      message: `API error: ${errorMessage}`,
      details: { error: errorMessage },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        health: "warning",
        message: "Request timeout",
        details: { error: "Connection timed out after 10 seconds" },
      };
    }

    throw error;
  }
}

/**
 * Test generic OpenAI-compatible endpoint.
 */
async function testGenericOpenAICompatible(apiKey: string, baseUrl: string): Promise<TestResult> {
  const url = `${baseUrl}/v1/models`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const data = await response.json() as ModelResponse;
      const models = data.data?.map((m) => m.id) || [];

      return {
        success: true,
        health: "normal",
        message: `Connected successfully. Found ${models.length} models.`,
        details: { models: models.slice(0, 10) },
      };
    }

    const errorData = await response.json().catch(() => ({})) as ErrorResponse;
    const errorMessage = errorData.error?.message || response.statusText;

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        health: "invalid",
        message: "Invalid API key",
        details: { error: errorMessage },
      };
    }

    if (response.status === 429) {
      return {
        success: false,
        health: "critical",
        message: "Rate limit exceeded",
        details: { error: errorMessage },
      };
    }

    return {
      success: false,
      health: "warning",
      message: `API error: ${errorMessage}`,
      details: { error: errorMessage },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        health: "warning",
        message: "Request timeout",
        details: { error: "Connection timed out after 10 seconds" },
      };
    }

    throw error;
  }
}
