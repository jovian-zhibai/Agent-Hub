import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, generateSSEToken, ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// GET /api/v1/auth/sse-token
// Generate a short-lived (5-minute) token for SSE connections.
// EventSource API cannot set custom headers, so a short-lived
// query-param token is the safe alternative to passing the
// full access/refresh JWT in the URL.
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    const sseToken = generateSSEToken(user.id);

    return NextResponse.json({ token: sseToken, expiresIn: 300 }, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode },
      );
    }

    console.error("[auth/sse-token] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 },
    );
  }
}