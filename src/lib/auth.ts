import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-in-production";
const ACCESS_TOKEN_EXPIRY = "2h";
const REFRESH_TOKEN_EXPIRY = "30d";

// ──────────────────────────────────────────────
// Token Payload
// ──────────────────────────────────────────────

export interface TokenPayload {
  userId: string;
  email: string;
}

export interface AgentTokenPayload {
  userId: string;
  type: "agent";
}

// ──────────────────────────────────────────────
// Password utilities
// ──────────────────────────────────────────────

/**
 * Hash a plain-text password.
 * Returns a bcrypt hash with 12 salt rounds.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/**
 * Verify a plain-text password against a bcrypt hash.
 */
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// ──────────────────────────────────────────────
// Token utilities
// ──────────────────────────────────────────────

/**
 * Generate access and refresh tokens for a user.
 */
export function generateTokens(payload: TokenPayload): {
  accessToken: string;
  refreshToken: string;
} {
  const accessToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
  const refreshToken = jwt.sign(payload, JWT_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
  return { accessToken, refreshToken };
}

/**
 * Verify and decode a JWT token.
 * Returns the token payload or null if invalid/expired.
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Generate an agent-specific long-lived JWT token.
 * Used by SDK/CLI for telemetry reporting and sync.
 * Intentionally no expiry on the constant — 365d is a reasonable
 * default; users rotate via the API when needed.
 */
export function generateAgentToken(userId: string): string {
  const payload: AgentTokenPayload = { userId, type: "agent" };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "365d" });
}

/**
 * Verify an agent token from the Authorization header.
 * Returns the userId if valid, or null if missing/invalid.
 */
export function verifyAgentToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AgentTokenPayload;
    if (decoded.type !== "agent") {
      return null;
    }
    return decoded.userId;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// Auth middleware
// ──────────────────────────────────────────────

/**
 * Extract and verify the authenticated user from a request.
 *
 * Reads the `Authorization: Bearer <token>` header, decodes the JWT,
 * and returns the corresponding Account record.
 *
 * Throws a standardized error response on failure.
 */
export async function getAuthUser(
  request: NextRequest
): Promise<{ id: string; email: string; name: string; plan: string }> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid authorization header", 401);
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    throw new AuthError("Invalid or expired token", 401);
  }

  const account = await prisma.account.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, plan: true },
  });

  if (!account) {
    throw new AuthError("User not found", 401);
  }

  return account;
}

// ──────────────────────────────────────────────
// Error helpers
// ──────────────────────────────────────────────

export class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

export class AuthError extends ApiError {
  constructor(message: string, statusCode: number = 401) {
    super(message, statusCode);
    this.name = "AuthError";
  }
}