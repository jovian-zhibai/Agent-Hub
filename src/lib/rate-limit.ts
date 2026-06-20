// ──────────────────────────────────────────────
// Rate Limiting Middleware
// Prevent API abuse with configurable rate limits
// ──────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";

/**
 * Simple in-memory rate limiter.
 * For production, consider using Redis or a dedicated service.
 */

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

// In-memory store (use Redis in production)
const requestCounts = new Map<string, RateLimitEntry>();

/**
 * Get client identifier from request.
 * Uses IP address or Authorization token.
 */
function getClientId(request: NextRequest): string {
  // Try to get IP from headers (handle proxies)
  const forwarded = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const ip = forwarded?.split(",")[0] || realIp || "unknown";

  // Use auth token if available (for authenticated requests)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7);
    return `token:${token.slice(0, 10)}`;
  }

  return `ip:${ip}`;
}

/**
 * Rate limiting middleware for API routes.
 * 
 * @param config - Rate limit configuration
 * @returns Middleware function
 * 
 * @example
 * ```typescript
 * export async function POST(request: NextRequest) {
 *   const rateLimitResult = await rateLimit({
 *     max: 10,
 *     windowMs: 60 * 1000, // 1 minute
 *   })(request);
 *   
 *   if (rateLimitResult) return rateLimitResult;
 *   
 *   // Handle request...
 * }
 * ```
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
    let entry = requestCounts.get(clientId);

    // Reset if window expired
    if (!entry || now > entry.resetTime) {
      entry = {
        count: 0,
        resetTime: now + windowMs,
      };
    }

    // Increment count
    entry.count++;
    requestCounts.set(clientId, entry);

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

    // Allow request (headers will be added by the caller if needed)
    return null;
  };
}

/**
 * Clean up expired entries periodically.
 * Call this in a background job or cron.
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  const keysToDelete: string[] = [];
  
  for (const [key, entry] of requestCounts.entries()) {
    if (now > entry.resetTime) {
      keysToDelete.push(key);
    }
  }
  
  keysToDelete.forEach(key => requestCounts.delete(key));
}

/**
 * Clear all rate limit entries (for testing).
 */
export function clearRateLimitStore(): void {
  requestCounts.clear();
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
 * 
 * @example
 * ```typescript
 * export const POST = createRateLimitedHandler(
 *   RateLimitPresets.strict,
 *   async (request: NextRequest) => {
 *     // Handle request...
 *     return NextResponse.json({ success: true });
 *   }
 * );
 * ```
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
  return setInterval(() => {
    cleanupRateLimitStore();
  }, intervalMs);
}
