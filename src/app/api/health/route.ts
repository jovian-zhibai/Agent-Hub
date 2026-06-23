// ──────────────────────────────────────────────
// Health Check Endpoint
// For Docker healthcheck and monitoring
// ──────────────────────────────────────────────

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // Check database connectivity
    await prisma.$queryRaw`SELECT 1`;

    const status = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      checks: {
        database: "connected",
        api: "operational",
      },
    };

    return NextResponse.json(status, { status: 200 });
  } catch (error) {
    const errorMessage = process.env.NODE_ENV === "production"
      ? "Database connection failed"
      : error instanceof Error ? error.message : String(error);

    const status = {
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      checks: {
        database: "disconnected",
        api: "operational",
      },
      error: errorMessage,
    };

    return NextResponse.json(status, { status: 503 });
  }
}
