// ──────────────────────────────────────────────
// Provider Tester — Test API key validity
// ──────────────────────────────────────────────

import { decryptKey } from "./crypto";

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
    const rateLimit = {
      remaining: response.headers.get("x-ratelimit-remaining"),
      reset: response.headers.get("x-ratelimit-reset"),
    };

    if (response.ok) {
      const data = await response.json();
      const models = data.data?.map((m: any) => m.id) || [];

      return {
        success: true,
        health: "normal",
        message: `Connected successfully. Found ${models.length} models.`,
        details: {
          models: models.slice(0, 10), // First 10 models
          rateLimit: {
            remaining: rateLimit.remaining ? parseInt(rateLimit.remaining) : undefined,
            reset: rateLimit.reset || undefined,
          },
        },
      };
    }

    // Handle error responses
    const errorData = await response.json().catch(() => ({}));
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
      const data = await response.json();
      const models = data.data?.map((m: any) => m.id) || [];

      return {
        success: true,
        health: "normal",
        message: `Connected successfully. Found ${models.length} models.`,
        details: { models: models.slice(0, 10) },
      };
    }

    const errorData = await response.json().catch(() => ({}));
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
      const data = await response.json();
      const models = data.data?.map((m: any) => m.id) || [];

      return {
        success: true,
        health: "normal",
        message: `Connected successfully. Found ${models.length} models.`,
        details: { models: models.slice(0, 10) },
      };
    }

    const errorData = await response.json().catch(() => ({}));
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
      const data = await response.json();
      const models = data.data?.map((m: any) => m.id) || [];

      return {
        success: true,
        health: "normal",
        message: `Connected successfully. Found ${models.length} models.`,
        details: { models: models.slice(0, 10) },
      };
    }

    const errorData = await response.json().catch(() => ({}));
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
