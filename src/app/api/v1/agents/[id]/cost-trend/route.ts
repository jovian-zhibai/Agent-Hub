import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import { uuidSchema, validate, ValidationError } from "@/lib/validation";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface CostTrendItem {
  date: string;   // "2026-06-15"
  cost: number;
  calls: number;
}

interface CostTrendResponse {
  trend: CostTrendItem[];
  total: number;
  lastUpdated: string;
}

// ──────────────────────────────────────────────
// UTC Helpers (B10: unify timezone to UTC)
// ──────────────────────────────────────────────

function utcDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function computeStartDateUTC(range: string | null): Date {
  const days = range === "30d" ? 30 : 7;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ──────────────────────────────────────────────
// GET /api/v1/agents/:id/cost-trend?range=7d|30d
// B4: reads TelemetryDaily aggregation table
// B10: UTC date buckets
// ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id: agentId } = await params;

    try {
      validate(uuidSchema, agentId);
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json(
          { code: "VALIDATION_ERROR", message: "Invalid ID format" },
          { status: 400 }
        );
      }
      throw e;
    }

    // ── Verify agent belongs to user ──────────
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { accountId: true },
    });

    if (!agent) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Agent not found" },
        { status: 404 }
      );
    }

    if (agent.accountId !== user.id) {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Access denied" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range");
    const startDate = computeStartDateUTC(range);

    // B4: read from aggregation table instead of scanning raw logs
    const dailyData = await prisma.telemetryDaily.findMany({
      where: {
        agentId,
        day: { gte: startDate },
      },
      orderBy: { day: "asc" },
      select: { day: true, cost: true, toolCalls: true },
    });

    if (dailyData.length === 0) {
      return NextResponse.json(
        { trend: [], total: 0, lastUpdated: new Date().toISOString() } satisfies CostTrendResponse,
        { status: 200 }
      );
    }

    const trend: CostTrendItem[] = dailyData.map((row) => ({
      date: utcDateKey(row.day),
      cost: Math.round(Number(row.cost) * 1000000) / 1000000,
      calls: row.toolCalls,
    }));

    const total = trend.reduce((sum, item) => sum + item.cost, 0);

    return NextResponse.json(
      { trend, total: Math.round(total * 1000000) / 1000000, lastUpdated: new Date().toISOString() } satisfies CostTrendResponse,
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[agents/id/cost-trend] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
