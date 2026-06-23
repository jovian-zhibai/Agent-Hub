import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret) {
  throw new Error("JWT_SECRET environment variable is required");
}
const JWT_SECRET: string = rawSecret;
const ACCESS_TOKEN_EXPIRY = "2h";
const REFRESH_TOKEN_EXPIRY = "30d";

// ──────────────────────────────────────────────
// Token Payload
// ──────────────────────────────────────────────

export interface TokenPayload {
  userId: string;
  email: string;
  type: "access" | "refresh";
  tokenVersion: number;
}

export interface AgentTokenPayload {
  userId: string;
  type: "agent";
  agentId?: string;
  tokenVersion: number;
}

export interface SSETokenPayload {
  userId: string;
  type: "sse";
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
export function generateTokens(
  payload: TokenPayload & { tokenVersion: number }
): {
  accessToken: string;
  refreshToken: string;
} {
  const accessToken = jwt.sign(
    { userId: payload.userId, email: payload.email, type: "access", tokenVersion: payload.tokenVersion },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
  const refreshToken = jwt.sign(
    { userId: payload.userId, type: "refresh", tokenVersion: payload.tokenVersion },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
  return { accessToken, refreshToken };
}

/**
 * Verify and decode a JWT token.
 * Returns the token payload or null if invalid/expired.
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    }) as TokenPayload;
    if (!decoded.type || (decoded.type !== "access" && decoded.type !== "refresh")) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Generate an agent-specific long-lived JWT token.
 * Used by SDK/CLI for telemetry reporting and sync.
 * Embeds tokenVersion so it can be revoked via password change.
 */
export function generateAgentToken(
  userId: string,
  tokenVersion: number,
  agentId?: string,
): string {
  const payload: AgentTokenPayload = { userId, type: "agent", tokenVersion };
  if (agentId) {
    payload.agentId = agentId;
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "365d" });
}

/**
 * Generate a short-lived SSE token (5 minutes).
 */
export function generateSSEToken(userId: string): string {
  const payload: SSETokenPayload = { userId, type: "sse" };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "5m" });
}

/**
 * Verify an SSE token from the ?token= query param.
 * Returns the userId if valid, or null if missing/invalid.
 */
export function verifySSEToken(token: string): string | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    }) as SSETokenPayload;
    if (decoded.type !== "sse") {
      return null;
    }
    return decoded.userId;
  } catch {
    return null;
  }
}

/**
 * Verify an agent token from the Authorization header.
 * Returns token payload if valid, or null if missing/invalid.
 */
export function verifyAgentToken(request: NextRequest): AgentTokenPayload | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    }) as AgentTokenPayload;
    if (decoded.type !== "agent") {
      return null;
    }
    // S2: Reject old agent tokens without tokenVersion (pre-fix)
    if (typeof decoded.tokenVersion !== "number") {
      return null;
    }
    return decoded;
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
): Promise<{ id: string; email: string; name: string; plan: string; tokenVersion: number }> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AuthError("Missing or invalid authorization header", 401);
  }

  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    throw new AuthError("Invalid or expired token", 401);
  }
  // S1: Refresh tokens must not be usable as access tokens
  if (payload.type !== "access") {
    throw new AuthError("Invalid token type", 401);
  }

  const account = await prisma.account.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, plan: true, tokenVersion: true },
  });

  if (!account) {
    throw new AuthError("User not found", 401);
  }

  // Check tokenVersion: if the stored version differs, the token has been revoked
  if (payload.tokenVersion !== account.tokenVersion) {
    throw new AuthError("Token has been revoked", 401);
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