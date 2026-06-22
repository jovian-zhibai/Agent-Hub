// ──────────────────────────────────────────────
// Rate Limiting Middleware
// Prevent API abuse with configurable rate limits
// C3: Use userId for authenticated requests, not JWT prefix
// C3: Don't trust X-Forwarded-For (unless PROXY_TRUSTED is set)
// C3: Add Redis backend interface with in-memory fallback
// C3: Periodic cleanup of expired entries
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

// ── Rate Limit Configuration ──────────────────

interface RateLimitConfig {
  /** Maximum requests per window */
  max: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Custom message when rate limit exceeded */
  message?: string;
  /** Skip rate limiting for certain conditions */
  skip?: (request: NextRequest) => boolean;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// ── Storage Backend Interface (C3) ────────────

interface RateLimitStore {
  get(key: string): Promise<RateLimitEntry | undefined>;
  set(key: string, entry: RateLimitEntry): Promise<void>;
  delete(key: string): Promise<void>;
  cleanup(): Promise<void>;
  clear(): Promise<void>;
}

// ── In-memory store (default) ─────────────────

class InMemoryStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();

  async get(key: string): Promise<RateLimitEntry | undefined> {
    return this.store.get(key);
  }

  async set(key: string, entry: RateLimitEntry): Promise<void> {
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const keysToDelete: string[] = [];
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      this.store.delete(key);
    }
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}

// ── Redis-backed store (future, interface only) ─
// To activate: set RATE_LIMIT_DRIVER=redis and configure REDIS_URL
// class RedisStore implements RateLimitStore {
//   constructor(private redis: any) {}
//   async get(key: string): Promise<RateLimitEntry | undefined> { ... }
//   async set(key: string, entry: RateLimitEntry): Promise<void> { ... }
//   async delete(key: string): Promise<void> { ... }
//   async cleanup(): Promise<void> { ... }
// }

// Select store backend
let store: RateLimitStore = new InMemoryStore();
if (process.env.RATE_LIMIT_DRIVER === "redis" && process.env.REDIS_URL) {
  // Production Redis support — uncomment when Redis is available
  // const redis = new Redis(process.env.REDIS_URL);
  // store = new RedisStore(redis);
}

/**
 * Get client identifier from request.
 * C3: Use userId if authenticated, fall back to IP.
 * C3: Don't trust X-Forwarded-For unless PROXY_TRUSTED is explicitly set.
 */
function getClientId(request: NextRequest): string {
  // Use authenticated userId when available (C3: stable per-user identifier)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    try {
      const rawSecret = process.env.JWT_SECRET;
      if (rawSecret) {
        const decoded = jwt.verify(authHeader.slice(7), rawSecret, {
          algorithms: ["HS256"],
        }) as { userId?: string };
        if (decoded.userId) {
          return `user:${decoded.userId}`;
        }
      }
    } catch {
      // Token decode failed — fall through to IP
    }
  }

  // C3: Only trust X-Forwarded-For if PROXY_TRUSTED environment variable is set
  if (process.env.PROXY_TRUSTED === "true") {
    const forwarded = request.headers.get("x-forwarded-for");
    const realIp = request.headers.get("x-real-ip");
    const ip = forwarded?.split(",")[0] || realIp || "unknown";
    return `ip:${ip}`;
  }

  // Direct connection: use x-real-ip or fallback
  return `ip:${request.headers.get("x-real-ip") || "direct"}`;
}

/**
 * Rate limiting middleware for API routes.
 * 
 * @param config - Rate limit configuration
 * @returns Middleware function
 */
export function rateLimit(config: RateLimitConfig) {
  const {
    max,
    windowMs,
    message = "Too many requests, please try again later.",
    skip,
  } = config;

  return async (request: NextRequest): Promise<NextResponse | null> => {
    // Skip rate limiting if condition met
    if (skip && skip(request)) {
      return null;
    }

    const clientId = getClientId(request);
    const now = Date.now();

    // Get or create rate limit entry
    let entry = await store.get(clientId);

    // Reset if window expired
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + windowMs,
      };
    }

    // Increment count
    entry.count++;
    await store.set(clientId, entry);

    // Calculate retry after
    const retryAfter = Math.ceil((entry.resetTime - now) / 1000);

    // Set rate limit headers
    const headers = new Headers({
      "X-RateLimit-Limit": max.toString(),
      "X-RateLimit-Remaining": Math.max(0, max - entry.count).toString(),
      "X-RateLimit-Reset": new Date(entry.resetTime).toISOString(),
    });

    // Check if limit exceeded
    if (entry.count > max) {
      headers.set("Retry-After", retryAfter.toString());

      return NextResponse.json(
        {
          code: "RATE_LIMIT_EXCEEDED",
          message,
          retryAfter,
        },
        { status: 429, headers }
      );
    }

    // Allow request
    return null;
  };
}

/**
 * Clean up expired entries periodically.
 * Call this in a background job or cron.
 */
export async function cleanupRateLimitStore(): Promise<void> {
  await store.cleanup();
}

/**
 * Clear all rate limit entries (for testing).
 */
export async function clearRateLimitStore(): Promise<void> {
  if (store instanceof InMemoryStore) {
    await store.clear();
  }
}

/**
 * Preset rate limit configurations.
 */
export const RateLimitPresets = {
  /** Strict limit for sensitive endpoints (auth, etc.) */
  strict: {
    max: 5,
    windowMs: 15 * 60 * 1000, // 15 minutes
    message: "Too many attempts. Please try again in 15 minutes.",
  },

  /** Standard limit for API endpoints */
  standard: {
    max: 100,
    windowMs: 60 * 1000, // 1 minute
    message: "Rate limit exceeded. Please slow down.",
  },

  /** Generous limit for read operations */
  generous: {
    max: 1000,
    windowMs: 60 * 1000, // 1 minute
  },

  /** Very strict for costly operations */
  veryStrict: {
    max: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
    message: "Rate limit exceeded. This operation is rate-limited to 3 per hour.",
  },
} as const;

/**
 * Helper to create a rate-limited API handler.
 */
export function createRateLimitedHandler(
  config: RateLimitConfig,
  handler: (request: NextRequest) => Promise<NextResponse>
) {
  const limiter = rateLimit(config);

  return async (request: NextRequest): Promise<NextResponse> => {
    const limitResult = await limiter(request);
    if (limitResult) {
      return limitResult;
    }

    return handler(request);
  };
}

/**
 * Start a cleanup interval to remove expired entries.
 * Call this once when the application starts.
 */
export function startRateLimitCleanup(intervalMs = 5 * 60 * 1000): NodeJS.Timeout {
  return setInterval(async () => {
    await cleanupRateLimitStore();
  }, intervalMs);
}
