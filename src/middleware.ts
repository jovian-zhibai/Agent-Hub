import { NextRequest, NextResponse } from "next/server";

// ──────────────────────────────────────────────
// Agent Hub — Middleware
// Handles CORS headers for all API routes.
// In production, enforces specific allowed origins.
// ──────────────────────────────────────────────

const NODE_ENV = process.env.NODE_ENV || "development";

// In production, ALLOWED_ORIGINS must be set to specific origins (comma-separated)
if (NODE_ENV === "production") {
  const allowedOrigins = process.env.ALLOWED_ORIGINS;
  if (!allowedOrigins || allowedOrigins === "*") {
    throw new Error("ALLOWED_ORIGINS must be set to specific origins in production");
  }
}

function getCorsOrigin(request: NextRequest): string {
  const origin = request.headers.get("origin") || "";

  if (NODE_ENV !== "production") {
    // Development: allow all origins for local dev
    return "*";
  }

  // Production: only allow whitelisted origins
  const allowedOrigins = process.env.ALLOWED_ORIGINS!.split(",").map((o) => o.trim());
  if (allowedOrigins.includes(origin)) {
    return origin;
  }
  return "null"; // Disallow origins not in the list
}

export function middleware(request: NextRequest) {
  const corsOrigin = getCorsOrigin(request);

  // Handle OPTIONS preflight requests
  if (request.method === "OPTIONS") {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Handle actual requests: add CORS headers
  const response = NextResponse.next();
  response.headers.set("Access-Control-Allow-Origin", corsOrigin);
  response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return response;
}

export const config = {
  matcher: "/api/:path*", // Only match API routes
};