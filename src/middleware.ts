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

function getCorsOrigin(request: NextRequest): string | null {
  const origin = request.headers.get("origin") || "";

  if (NODE_ENV !== "production") {
    // Development: reflect request origin (cannot use "*" with credentials)
    return origin || "*";
  }

  // Production: only allow whitelisted origins
  const allowedOrigins = process.env.ALLOWED_ORIGINS!.split(",").map((o) => o.trim());
  if (origin && allowedOrigins.includes(origin)) {
    return origin;
  }
  // S12: Return null for disallowed origins — do NOT send "null" (browsers
  // send Origin: null in sandboxed contexts, which would then be reflected).
  return null;
}

export function middleware(request: NextRequest) {
  const corsOrigin = getCorsOrigin(request);

  // Handle OPTIONS preflight requests
  if (request.method === "OPTIONS") {
    // S12: Reject preflight from disallowed origins with 403
    if (corsOrigin === null) {
      return new NextResponse(null, { status: 403 });
    }
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  // Handle actual requests: add CORS headers
  const response = NextResponse.next();
  // S12: Only set ACAO header for allowed origins; omit it entirely for
  // disallowed origins so the browser blocks the response.
  if (corsOrigin !== null) {
    response.headers.set("Access-Control-Allow-Origin", corsOrigin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  return response;
}

export const config = {
  matcher: "/api/:path*", // Only match API routes
};
