import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";

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
}

interface TokenUsagePayload {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  tokensIn?: number;
  tokensOut?: number;
  totalTokens?: number;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Build a date string key (YYYY-MM-DD) from a Date object.
 */
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Compute the start date from a range string.
 * Defaults to 7 days if range is invalid.
 */
function computeStartDate(range: string | null): Date {
  const days = range === "30d" ? 30 : 7;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ──────────────────────────────────────────────
// GET /api/v1/agents/:id/cost-trend?range=7d|30d
// 返回过去 N 天的每日花费趋势
// ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id: agentId } = await params;

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

    // ── Parse query params ────────────────────
    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range"); // "7d" or "30d"
    const startDate = computeStartDate(range);

    // ── Fetch token_usage events ──────────────
    const usageEvents = await prisma.telemetryLog.findMany({
      where: {
        agentId,
        eventType: "token_usage",
        reportedAt: { gte: startDate },
      },
      select: {
        payload: true,
        reportedAt: true,
      },
      orderBy: { reportedAt: "asc" },
    });

    if (usageEvents.length === 0) {
      return NextResponse.json(
        { trend: [], total: 0 } satisfies CostTrendResponse,
        { status: 200 }
      );
    }

    // ── Load models pricing lookup ────────────
    const allModels = await prisma.model.findMany({
      where: { isActive: true },
      select: {
        modelName: true,
        pricingInput: true,
        pricingOutput: true,
      },
    });
    const pricingMap = new Map<string, { pricingInput: number; pricingOutput: number }>();
    for (const m of allModels) {
      if (!pricingMap.has(m.modelName)) {
        pricingMap.set(m.modelName, {
          pricingInput: Number(m.pricingInput),
          pricingOutput: Number(m.pricingOutput),
        });
      }
    }

    // ── Aggregate by day ──────────────────────
    const dayMap = new Map<string, { cost: number; calls: number }>();

    for (const event of usageEvents) {
      const payload = event.payload as TokenUsagePayload;
      const day = dateKey(event.reportedAt);
      const model = payload.model ?? "unknown";
      const tokensIn = (payload.tokensIn as number) || (payload.promptTokens as number) || 0;
      const tokensOut = (payload.tokensOut as number) || (payload.completionTokens as number) || 0;

      // Look up pricing
      const pricing = pricingMap.get(model);
      let cost = 0;
      if (pricing) {
        cost = (tokensIn * pricing.pricingInput + tokensOut * pricing.pricingOutput) / 1_000_000;
      }

      const existing = dayMap.get(day) ?? { cost: 0, calls: 0 };
      dayMap.set(day, {
        cost: existing.cost + cost,
        calls: existing.calls + 1,
      });
    }

    // ── Build sorted trend array ──────────────
    const sortedDays = Array.from(dayMap.keys()).sort();
    const trend: CostTrendItem[] = sortedDays.map((date) => ({
      date,
      cost: Math.round(dayMap.get(date)!.cost * 1000000) / 1000000,
      calls: dayMap.get(date)!.calls,
    }));

    const total = trend.reduce((sum, item) => sum + item.cost, 0);

    return NextResponse.json(
      { trend, total: Math.round(total * 1000000) / 1000000 } satisfies CostTrendResponse,
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
