import { NextResponse } from "next/server";

// ──────────────────────────────────────────────
// POST /api/v1/auth/logout
// Clears the HttpOnly refresh token cookie
// ──────────────────────────────────────────────

export async function POST() {
  const response = NextResponse.json({ success: true }, { status: 200 });

  // Clear the refresh token cookie by setting it to expire immediately
  response.cookies.set("refresh_token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/auth",
    expires: new Date(0),
  });

  return response;
}
