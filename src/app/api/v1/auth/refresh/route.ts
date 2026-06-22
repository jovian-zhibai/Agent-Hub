import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// POST /api/v1/auth/refresh
// Exchange a refresh token for a new access token.
// Implements token rotation: issues a new refreshToken
// so the old one becomes invalid upon use.
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    // C7: Try to read refresh_token from HttpOnly cookie first, fall back to request body
    let refreshToken = request.cookies.get("refresh_token")?.value;
    if (!refreshToken) {
      refreshToken = (body as { refreshToken?: string }).refreshToken;
    }

    if (!refreshToken) {
      return NextResponse.json(
        { code: "MISSING_TOKEN", message: "refreshToken is required" },
        { status: 400 }
      );
    }

    // Validate refreshToken
    const JWT_SECRET = process.env.JWT_SECRET;
    if (!JWT_SECRET) throw new Error("JWT_SECRET not configured");

    let decoded: { userId: string; type?: string; tokenVersion?: number };
    try {
      decoded = jwt.verify(refreshToken, JWT_SECRET, {
        algorithms: ["HS256"],
      }) as { userId: string; type?: string; tokenVersion?: number };
    } catch {
      return NextResponse.json(
        { code: "INVALID_TOKEN", message: "Refresh token expired or invalid" },
        { status: 401 }
      );
    }

    // C1: Validate token type is "refresh"
    if (decoded.type !== "refresh") {
      return NextResponse.json(
        { code: "INVALID_TOKEN", message: "Invalid token type" },
        { status: 401 }
      );
    }

    // Verify user still exists and check tokenVersion
    const user = await prisma.account.findUnique({
      where: { id: decoded.userId },
      select: { id: true, tokenVersion: true },
    });

    if (!user) {
      return NextResponse.json(
        { code: "USER_NOT_FOUND", message: "User no longer exists" },
        { status: 401 }
      );
    }

    // C2: Check tokenVersion — if it doesn't match, the token was revoked
    if (decoded.tokenVersion !== undefined && decoded.tokenVersion !== user.tokenVersion) {
      return NextResponse.json(
        { code: "TOKEN_REVOKED", message: "Token has been revoked" },
        { status: 401 }
      );
    }

    // Issue new access token + new refresh token (rotation)
    const newAccessToken = jwt.sign(
      { userId: user.id, type: "access", tokenVersion: user.tokenVersion },
      JWT_SECRET,
      { expiresIn: "2h" }
    );
    const newRefreshToken = jwt.sign(
      { userId: user.id, type: "refresh", tokenVersion: user.tokenVersion },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    // C7: Set new refresh token as HttpOnly cookie
    const response = NextResponse.json(
      { accessToken: newAccessToken },
      { status: 200 }
    );

    response.cookies.set("refresh_token", newRefreshToken, {
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

    console.error("[auth/refresh] Error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}