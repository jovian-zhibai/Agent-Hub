import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, generateTokens, generateAgentToken, ApiError } from "@/lib/auth";
import { rateLimit, RateLimitPresets } from "@/lib/rate-limit";

// ──────────────────────────────────────────────
// POST /api/v1/auth/login
// Authenticate and return JWT tokens
// Rate limited to prevent brute force attacks
// ──────────────────────────────────────────────

const loginRateLimiter = rateLimit(RateLimitPresets.strict);

export async function POST(request: NextRequest) {
  // Apply rate limiting
  const rateLimitResult = await loginRateLimiter(request);
  if (rateLimitResult) {
    return rateLimitResult;
  }

  try {
    const body = await request.json();
    const { email, password } = body as {
      email?: string;
      password?: string;
    };

    // ── Validate inputs ────────────────────────
    if (!email || !password) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "Email and password are required" },
        { status: 400 }
      );
    }

    // ── Find account ───────────────────────────
    const account = await prisma.account.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
      },
    });

    if (!account) {
      return NextResponse.json(
        { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
        { status: 401 }
      );
    }

    // ── Verify password ────────────────────────
    const valid = await verifyPassword(password, account.passwordHash);
    if (!valid) {
      return NextResponse.json(
        { code: "INVALID_CREDENTIALS", message: "Invalid email or password" },
        { status: 401 }
      );
    }

    // ── Generate tokens ────────────────────────
    const { accessToken, refreshToken } = generateTokens({
      userId: account.id,
      email: account.email,
    });
    const agentToken = generateAgentToken(account.id);

    return NextResponse.json(
      {
        accessToken,
        refreshToken,
        agentToken,
        user: {
          id: account.id,
          email: account.email,
          name: account.name,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[auth/login] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
