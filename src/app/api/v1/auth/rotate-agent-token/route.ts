import { NextRequest, NextResponse } from "next/server";
import { getAuthUser, generateAgentToken, ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// POST /api/v1/auth/rotate-agent-token
// Re-issue a new agent token for the current user.
// Old tokens remain valid until their natural expiry.
// Users call this manually from the dashboard if
// they suspect a token has been compromised.
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    const agentToken = generateAgentToken(user.id);

    return NextResponse.json(
      { agentToken },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode },
      );
    }

    console.error("[auth/rotate-agent-token] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 },
    );
  }
}
