import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, generateTokens, generateAgentToken, ApiError } from "@/lib/auth";
import { rateLimit, RateLimitPresets } from "@/lib/rate-limit";

// ──────────────────────────────────────────────
// POST /api/v1/auth/register
// Create a new account and return JWT tokens
// Rate limited to prevent spam registrations
// ──────────────────────────────────────────────

const registerRateLimiter = rateLimit(RateLimitPresets.strict);

export async function POST(request: NextRequest) {
  // Apply rate limiting
  const rateLimitResult = await registerRateLimiter(request);
  if (rateLimitResult) {
    return rateLimitResult;
  }

  try {
    const body = await request.json();
    const { email, password, name } = body as {
      email?: string;
      password?: string;
      name?: string;
    };

    // ── Validate inputs ────────────────────────
    if (!email || !password) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Email and password are required" },
        { status: 400 }
      );
    }

    if (typeof email !== "string" || typeof password !== "string") {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Email and password must be strings" },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Password must be at least 6 characters" },
        { status: 400 }
      );
    }

    // ── Check for existing account ─────────────
    const existing = await prisma.account.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      return NextResponse.json(
        { code: "CONFLICT", message: "Email already registered" },
        { status: 409 }
      );
    }

    // ── Create account ─────────────────────────
    const hashed = await hashPassword(password);
    const account = await prisma.account.create({
      data: {
        email,
        name: name || email.split("@")[0],
        plan: "free",
        passwordHash: hashed,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    // ── Generate tokens ────────────────────────
    const { accessToken, refreshToken } = generateTokens({
      userId: account.id,
      email: account.email,
      type: "access",
      tokenVersion: 0, // New account starts at version 0
    });
    const agentToken = generateAgentToken(account.id);
    const expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2小时后

    // Store refresh token as HttpOnly cookie
    const response = NextResponse.json(
      {
        user: {
          id: account.id,
          email: account.email,
          name: account.name,
        },
        accessToken,
        agentToken,
        expiresAt,
      },
      { status: 201 }
    );

    response.cookies.set("refresh_token", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/api/v1/auth",
      maxAge: 30 * 24 * 60 * 60, // 30 天
    });

    return response;
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[auth/register] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
