import { describe, expect, it } from "vitest";
import {
  formatValidationErrors,
  loginSchema,
  paginationSchema,
  telemetryEventSchema,
  ValidationError,
  validate,
} from "../validation";

describe("Validation schemas", () => {
  it("applies pagination defaults and coerces numeric strings", () => {
    const result = paginationSchema.parse({ page: "2", limit: "50" });

    expect(result).toEqual({ page: 2, limit: 50 });
  });

  it("rejects pagination limits above the configured maximum", () => {
    expect(paginationSchema.safeParse({ limit: 101 }).success).toBe(false);
  });

  it("accepts a valid login payload", () => {
    const result = loginSchema.parse({
      email: "agent@example.test",
      password: "password-123",
    });

    expect(result.email).toBe("agent@example.test");
  });

  it("rejects invalid email and short passwords", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "password-123" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "agent@example.test", password: "short" }).success).toBe(false);
  });

  it("validates a minimal telemetry event", () => {
    const event = {
      agentId: "9b1deb4d-1b7d-4bed-9b80-8f0b6c8c9d84",
      eventType: "heartbeat",
      payload: {},
      timestamp: 1,
    };

    expect(telemetryEventSchema.safeParse(event).success).toBe(true);
  });

  it("formats Zod issue paths and messages", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "password-123" });

    expect(result.success).toBe(false);
    if (result.success) return;

    const message = formatValidationErrors(result.error);
    expect(message).toContain("email");
  });

  it("validate throws the repository ValidationError type", () => {
    expect(() => validate(loginSchema, { email: "not-an-email", password: "password-123" })).toThrow(
      ValidationError,
    );
  });
});
