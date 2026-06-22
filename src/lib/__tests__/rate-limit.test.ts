// ──────────────────────────────────────────────
// Rate Limiting Tests
// ──────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { 
  rateLimit, 
  RateLimitPresets, 
  cleanupRateLimitStore,
  clearRateLimitStore 
} from "../rate-limit";

// Mock NextRequest
function createMockRequest(ip = "127.0.0.1", authToken?: string): NextRequest {
  const headers = new Headers({
    "x-forwarded-for": ip,
  });

  if (authToken) {
    headers.set("authorization", `Bearer ${authToken}`);
  }

  return {
    headers,
    url: "http://localhost:3000/api/test",
  } as NextRequest;
}

describe("Rate Limiting", () => {
  beforeEach(async () => {
    // Clean up before each test
    await clearRateLimitStore();
  });

  describe("rateLimit", () => {
    it("should allow requests within limit", async () => {
      const limiter = rateLimit({ max: 5, windowMs: 60000 });
      const request = createMockRequest();

      // First 5 requests should pass
      for (let i = 0; i < 5; i++) {
        const result = await limiter(request);
        expect(result).toBeNull();
      }
    });

    it("should block requests exceeding limit", async () => {
      const limiter = rateLimit({ max: 3, windowMs: 60000 });
      const request = createMockRequest();

      // First 3 requests pass
      for (let i = 0; i < 3; i++) {
        await limiter(request);
      }

      // 4th request should be blocked
      const result = await limiter(request);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(429);

      const body = await result?.json();
      expect(body.code).toBe("RATE_LIMIT_EXCEEDED");
    });

    it("should track different IPs separately", async () => {
      const limiter = rateLimit({ max: 2, windowMs: 60000 });

      const request1 = createMockRequest("192.168.1.1");
      const request2 = createMockRequest("192.168.1.2");

      // Each IP gets its own limit
      await limiter(request1);
      await limiter(request1);

      await limiter(request2);
      await limiter(request2);

      // 3rd request from each IP should be blocked
      const result1 = await limiter(request1);
      const result2 = await limiter(request2);

      expect(result1?.status).toBe(429);
      expect(result2?.status).toBe(429);
    });

    it("should use auth token for authenticated requests", async () => {
      const limiter = rateLimit({ max: 2, windowMs: 60000 });

      const request1 = createMockRequest("127.0.0.1", "token123");
      const request2 = createMockRequest("127.0.0.1", "token456");

      // Different tokens, different limits
      await limiter(request1);
      await limiter(request1);

      await limiter(request2);
      await limiter(request2);

      const result1 = await limiter(request1);
      const result2 = await limiter(request2);

      expect(result1?.status).toBe(429);
      expect(result2?.status).toBe(429);
    });

    it("should reset after time window", async () => {
      vi.useFakeTimers();

      const limiter = rateLimit({ max: 2, windowMs: 1000 });
      const request = createMockRequest();

      // Use up the limit
      await limiter(request);
      await limiter(request);

      // Should be blocked
      let result = await limiter(request);
      expect(result?.status).toBe(429);

      // Fast-forward time past the window
      vi.advanceTimersByTime(1001);

      // Should be allowed again
      result = await limiter(request);
      expect(result).toBeNull();

      vi.useRealTimers();
    });

    it("should include rate limit headers", async () => {
      const limiter = rateLimit({ max: 5, windowMs: 60000 });
      const request = createMockRequest();

      await limiter(request);
      await limiter(request);

      // 3rd request should be blocked
      const result = await limiter(request);
      await limiter(request);
      await limiter(request);
      await limiter(request);

      const blockedResult = await limiter(request);

      expect(blockedResult?.headers.get("X-RateLimit-Limit")).toBe("5");
      expect(blockedResult?.headers.get("Retry-After")).toBeTruthy();
    });

    it("should skip rate limiting when condition met", async () => {
      const limiter = rateLimit({
        max: 1,
        windowMs: 60000,
        skip: (req) => req.headers.get("x-skip") === "true",
      });

      const request = createMockRequest();
      request.headers.set("x-skip", "true");

      // Should never be rate limited
      for (let i = 0; i < 10; i++) {
        const result = await limiter(request);
        expect(result).toBeNull();
      }
    });

    it("should use custom message", async () => {
      const customMessage = "Custom rate limit message";
      const limiter = rateLimit({
        max: 1,
        windowMs: 60000,
        message: customMessage,
      });

      const request = createMockRequest();

      await limiter(request);
      const result = await limiter(request);

      const body = await result?.json();
      expect(body.message).toBe(customMessage);
    });
  });

  describe("RateLimitPresets", () => {
    it("should have strict preset", () => {
      expect(RateLimitPresets.strict).toBeDefined();
      expect(RateLimitPresets.strict.max).toBe(5);
      expect(RateLimitPresets.strict.windowMs).toBe(15 * 60 * 1000);
    });

    it("should have standard preset", () => {
      expect(RateLimitPresets.standard).toBeDefined();
      expect(RateLimitPresets.standard.max).toBe(100);
    });

    it("should have generous preset", () => {
      expect(RateLimitPresets.generous).toBeDefined();
      expect(RateLimitPresets.generous.max).toBe(1000);
    });

    it("should have veryStrict preset", () => {
      expect(RateLimitPresets.veryStrict).toBeDefined();
      expect(RateLimitPresets.veryStrict.max).toBe(3);
    });
  });

  describe("cleanupRateLimitStore", () => {
    it("should remove expired entries", async () => {
      vi.useFakeTimers();

      const limiter = rateLimit({ max: 5, windowMs: 1000 });
      const request = createMockRequest();

      // Make some requests
      await limiter(request);
      await limiter(request);

      // Fast-forward past expiry
      vi.advanceTimersByTime(1001);

      // Cleanup
      cleanupRateLimitStore();

      // Should start fresh
      for (let i = 0; i < 5; i++) {
        const result = await limiter(request);
        expect(result).toBeNull();
      }

      vi.useRealTimers();
    });
  });
});
