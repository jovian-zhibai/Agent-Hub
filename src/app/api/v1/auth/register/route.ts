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
    });
    const agentToken = generateAgentToken(account.id);

    return NextResponse.json(
      {
        user: {
          id: account.id,
          email: account.email,
          name: account.name,
        },
        accessToken,
        refreshToken,
        agentToken,
      },
      { status: 201 }
    );
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
