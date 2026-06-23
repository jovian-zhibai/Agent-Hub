import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { verifyPassword, generateTokens, generateAgentToken, ApiError } from "@/lib/auth";
import { rateLimit, RateLimitPresets } from "@/lib/rate-limit";
import { loginSchema, validate, ValidationError, formatValidationErrors } from "@/lib/validation";

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
    // B11: replace manual `body as {}` + ad-hoc checks with zod schema
    const { email, password } = validate(loginSchema, body);

    // ── Find account ───────────────────────────
    const account = await prisma.account.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        tokenVersion: true,
      },
    });

    // C6: Constant-time check — always run bcrypt even if user doesn't exist
    // to prevent user enumeration via timing attacks
    const DUMMY_HASH = "$2b$12$LJ3m4ys3Lk0TSwHlLkMkY.5P6Q7R8S9T0U1V2W3X4Y5Z6a7b8c9d0e";
    if (!account) {
      await bcrypt.compare("dummy-constant-time-check", DUMMY_HASH);
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
      type: "access",
      tokenVersion: account.tokenVersion,
    });
    const agentToken = generateAgentToken(account.id, account.tokenVersion);
    const expiresAt = Date.now() + 2 * 60 * 60 * 1000; // 2小时后

    // C7: Store refresh token as HttpOnly cookie, not in response body
    const response = NextResponse.json(
      {
        accessToken,
        agentToken,
        expiresAt,
        user: {
          id: account.id,
          email: account.email,
          name: account.name,
        },
      },
      { status: 200 }
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
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: formatValidationErrors(error.errors) },
        { status: 400 }
      );
    }
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
