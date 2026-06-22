// ──────────────────────────────────────────────
// Test Helpers
// Utilities for testing API routes and components
// ──────────────────────────────────────────────

import { NextRequest } from "next/server";

/**
 * Create a mock NextRequest for testing API routes.
 */
export function createMockRequest(
  method: string,
  url: string,
  options?: {
    body?: unknown;
    headers?: Record<string, string>;
    searchParams?: Record<string, string>;
  }
): NextRequest {
  const fullUrl = new URL(url, "http://localhost:3000");

  // Add search params if provided
  if (options?.searchParams) {
    Object.entries(options.searchParams).forEach(([key, value]) => {
      fullUrl.searchParams.set(key, value);
    });
  }

  const headers = new Headers(options?.headers || {});
  headers.set("content-type", "application/json");

  const init: {
    method: string;
    headers: Headers;
    body?: string;
  } = {
    method,
    headers,
  };

  if (options?.body && (method === "POST" || method === "PATCH" || method === "PUT")) {
    init.body = JSON.stringify(options.body);
  }

  return new NextRequest(fullUrl, init as RequestInit & { signal?: AbortSignal });
}

/**
 * Create a mock authenticated request with JWT token.
 */
export function createAuthenticatedRequest(
  method: string,
  url: string,
  token: string,
  options?: {
    body?: unknown;
    headers?: Record<string, string>;
    searchParams?: Record<string, string>;
  }
): NextRequest {
  const headers = {
    ...options?.headers,
    authorization: `Bearer ${token}`,
  };

  return createMockRequest(method, url, {
    ...options,
    headers,
  });
}

/**
 * Extract JSON body from NextResponse.
 */
export async function getResponseBody<T = unknown>(response: Response): Promise<T | null> {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Assert response status and return parsed body.
 */
export async function expectResponse<T = unknown>(
  response: Response,
  expectedStatus: number
): Promise<T | null> {
  if (response.status !== expectedStatus) {
    const body = await getResponseBody(response);
    throw new Error(
      `Expected status ${expectedStatus}, got ${response.status}. Body: ${JSON.stringify(body)}`
    );
  }
  return getResponseBody<T>(response);
}

/**
 * Mock environment variables for tests.
 */
export function mockEnv(vars: Record<string, string>): () => void {
  const original = { ...process.env };

  Object.entries(vars).forEach(([key, value]) => {
    process.env[key] = value;
  });

  // Return cleanup function
  return () => {
    process.env = original;
  };
}

/**
 * Generate a test JWT token (for testing only).
 */
export function generateTestToken(payload: Record<string, unknown>): string {
  // Simple base64 encoding for testing (NOT secure, only for tests)
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64");
  const signature = "test-signature";
  return `${header}.${body}.${signature}`;
}

/**
 * Wait for a promise with timeout.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

/**
 * Sleep for specified milliseconds.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock database record.
 */
export function createMockRecord<T extends object>(base: T, overrides?: Partial<T>): T {
  return {
    ...base,
    ...overrides,
  };
}

/**
 * Generate random test data.
 */
export const testData = {
  email: () => `test-${Date.now()}@example.com`,
  uuid: () => crypto.randomUUID(),
  string: (prefix = "test") => `${prefix}-${Date.now()}`,
  number: (min = 0, max = 1000) => Math.floor(Math.random() * (max - min + 1)) + min,
};
