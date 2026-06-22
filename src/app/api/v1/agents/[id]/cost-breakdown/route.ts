import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import {
  loadPricingMap,
  computeEventCost,
} from "@/lib/cost";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface CostBreakdownItem {
  model: string;
  displayName: string;
  cost: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  percentage: number;
}

interface CostBreakdownResponse {
  breakdown: CostBreakdownItem[];
  total: number;
  lastUpdated: string;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Compute the UTC start-of-day `days` days ago.
 *
 * B10: previously used `new Date()` + `setHours(0,0,0,0)` which
 * buckets by server-local time, drifting from the UTC day buckets
 * used at ingest time. Now aligned with the rest of the cost
 * surfaces (dashboard, cost-trend, agents route).
 */
function computeStartDateUTC(range: string | null): Date {
  const days = range === "30d" ? 30 : 7;
  const now = new Date();
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - days,
      0,
      0,
      0,
      0,
    ),
  );
}

// ──────────────────────────────────────────────
// GET /api/v1/agents/:id/cost-breakdown?range=7d|30d
// 返回按模型的花费明细
//
// Note: per-model breakdown still scans telemetry_logs because
// TelemetryDaily has no `model` dimension. We do, however,
// centralize token extraction + cost math via `cost.ts` so the
// numbers match every other cost surface (fixes B9 + B14).
// ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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
        { status: 404 },
      );
    }

    if (agent.accountId !== user.id) {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Access denied" },
        { status: 403 },
      );
    }

    // ── Parse query params ────────────────────
    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range");
    const startDate = computeStartDateUTC(range);

    // ── Fetch token_usage events ──────────────
    const usageEvents = await prisma.telemetryLog.findMany({
      where: {
        agentId,
        eventType: "token_usage",
        reportedAt: { gte: startDate },
      },
      select: { payload: true },
    });

    if (usageEvents.length === 0) {
      return NextResponse.json(
        {
          breakdown: [],
          total: 0,
          lastUpdated: new Date().toISOString(),
        } satisfies CostBreakdownResponse,
        { status: 200 },
      );
    }

    // ── Load pricing lookup (centralized) ─────
    const pricingMap = await loadPricingMap(prisma, {
      includeDisplayName: true,
    });

    // ── Aggregate by model ────────────────────
    const modelMap = new Map<
      string,
      {
        cost: number;
        calls: number;
        tokensIn: number;
        tokensOut: number;
      }
    >();

    for (const event of usageEvents) {
      // computeEventCost handles both tokensIn/tokensOut (new)
      // and promptTokens/completionTokens (legacy) — fixes B9.
      const { cost, tokensIn, tokensOut, model } = computeEventCost(
        event.payload as Record<string, unknown>,
        pricingMap,
      );

      const existing =
        modelMap.get(model) ?? {
          cost: 0,
          calls: 0,
          tokensIn: 0,
          tokensOut: 0,
        };
      modelMap.set(model, {
        cost: existing.cost + cost,
        calls: existing.calls + 1,
        tokensIn: existing.tokensIn + tokensIn,
        tokensOut: existing.tokensOut + tokensOut,
      });
    }

    // ── Compute totals ────────────────────────
    let totalCost = 0;
    const rawItems: Array<{
      model: string;
      cost: number;
      calls: number;
      tokensIn: number;
      tokensOut: number;
    }> = [];

    for (const [model, data] of modelMap) {
      totalCost += data.cost;
      rawItems.push({ model, ...data });
    }

    // ── Build sorted breakdown (cost desc) ────
    rawItems.sort((a, b) => b.cost - a.cost);

    const breakdown: CostBreakdownItem[] = rawItems.map((item) => {
      const pricing = pricingMap.get(item.model);
      const percentage = totalCost > 0 ? (item.cost / totalCost) * 100 : 0;

      return {
        model: item.model,
        displayName: pricing?.displayName ?? item.model,
        cost: Math.round(item.cost * 1000000) / 1000000,
        calls: item.calls,
        tokensIn: item.tokensIn,
        tokensOut: item.tokensOut,
        percentage: Math.round(percentage * 100) / 100,
      };
    });

    return NextResponse.json(
      {
        breakdown,
        total: Math.round(totalCost * 1000000) / 1000000,
        lastUpdated: new Date().toISOString(),
      } satisfies CostBreakdownResponse,
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR",
          message: error.message,
        },
        { status: error.statusCode },
      );
    }

    console.error("[agents/id/cost-breakdown] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 },
    );
  }
}
