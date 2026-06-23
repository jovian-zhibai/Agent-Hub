import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import { computeEventCost, loadPricingMap } from "@/lib/cost";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface KeyInfo {
  id: string;
  keyLabel: string;
  provider: { name: string };
  health: string;
  initialBalance: number | null;
  burnRate: number | null;
}

interface KeyUsage {
  totalCost: number;
  totalCalls: number;
  totalTokensIn: number;
  totalTokensOut: number;
}

interface ByAgentItem {
  agentId: string;
  agentName: string;
  cost: number;
  calls: number;
}

interface DailyTrendItem {
  date: string;
  cost: number;
  calls: number;
}

interface KeyUsageResponse {
  key: KeyInfo;
  usage: KeyUsage;
  byAgent: ByAgentItem[];
  dailyTrend: DailyTrendItem[];
  failoverCount: number;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

// B10: UTC date key (consistent with dashboard/cost-trend)
function utcDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function computeStartDate(range: string | null): Date {
  const days = range === "30d" ? 30 : 7;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ──────────────────────────────────────────────
// GET /api/v1/keys/:id/usage?range=7d|30d
// 返回单个 Key 的用量汇总
// ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id: keyId } = await params;

    // ── Verify key belongs to user ────────────
    const key = await prisma.key.findUnique({
      where: { id: keyId },
      select: {
        accountId: true,
        id: true,
        keyLabel: true,
        health: true,
        initialBalance: true,
        burnRate: true,
        provider: { select: { name: true } },
      },
    });

    if (!key) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Key not found" },
        { status: 404 }
      );
    }

    if (key.accountId !== user.id) {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Access denied" },
        { status: 403 }
      );
    }

    // ── Parse query params ────────────────────
    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range");
    const startDate = computeStartDate(range);

    // ── Parallel queries ──────────────────────
    // Query telemetry with agentId included for grouping
    const [usageEvents, failoverCount] = await Promise.all([
      prisma.telemetryLog.findMany({
        where: {
          keyId,
          eventType: "token_usage",
          reportedAt: { gte: startDate },
        },
        select: { payload: true, reportedAt: true, agentId: true },
        orderBy: { reportedAt: "asc" },
      }),

      // Failover count: times this key was used as a failover backup destination
      prisma.failoverLog.count({
        where: {
          toKeyId: keyId,
          triggeredAt: { gte: startDate },
        },
      }),
    ]);

    // ── Load pricing map (B9/B14: use centralized cost.ts) ──
    const pricingMap = await loadPricingMap(prisma);

    // ── Aggregate ─────────────────────────────
    let totalCost = 0;
    let totalCalls = 0;
    let totalTokensIn = 0;
    let totalTokensOut = 0;

    // Per-agent aggregation
    const agentMap = new Map<string, { cost: number; calls: number }>();

    // Daily trend
    const dayMap = new Map<string, { cost: number; calls: number }>();

    // Track agentIds for name resolution
    const seenAgentIds = new Set<string>();

    for (const event of usageEvents) {
      // B9/B14: Use computeEventCost (handles tokensIn/tokensOut + promptTokens/completionTokens)
      const { cost, tokensIn, tokensOut } = computeEventCost(
        event.payload as Record<string, unknown>,
        pricingMap,
      );

      totalCost += cost;
      totalCalls += 1;
      totalTokensIn += tokensIn;
      totalTokensOut += tokensOut;

      // By agent
      const agentKey = event.agentId;
      const existingAgent = agentMap.get(agentKey) ?? { cost: 0, calls: 0 };
      agentMap.set(agentKey, {
        cost: existingAgent.cost + cost,
        calls: existingAgent.calls + 1,
      });
      seenAgentIds.add(agentKey);

      // By day (B10: UTC date key)
      const day = utcDateKey(event.reportedAt);
      const existingDay = dayMap.get(day) ?? { cost: 0, calls: 0 };
      dayMap.set(day, {
        cost: existingDay.cost + cost,
        calls: existingDay.calls + 1,
      });
    }

    // ── Resolve agent names ───────────────────
    const agentNameMap = new Map<string, string>();
    if (seenAgentIds.size > 0) {
      const agentRecords = await prisma.agent.findMany({
        where: { id: { in: Array.from(seenAgentIds) } },
        select: { id: true, name: true },
      });
      for (const a of agentRecords) {
        agentNameMap.set(a.id, a.name);
      }
    }

    // ── Sort by agent cost desc ───────────────
    const byAgent: ByAgentItem[] = Array.from(agentMap.entries())
      .map(([agentId, data]) => ({
        agentId,
        agentName: agentNameMap.get(agentId) ?? "Unknown",
        cost: Math.round(data.cost * 1000000) / 1000000,
        calls: data.calls,
      }))
      .sort((a, b) => b.cost - a.cost);

    // ── Sort daily trend by date ──────────────
    const sortedDays = Array.from(dayMap.keys()).sort();
    const dailyTrend: DailyTrendItem[] = sortedDays.map((date) => ({
      date,
      cost: Math.round(dayMap.get(date)!.cost * 1000000) / 1000000,
      calls: dayMap.get(date)!.calls,
    }));

    // ── Build response ────────────────────────
    const response: KeyUsageResponse = {
      key: {
        id: key.id,
        keyLabel: key.keyLabel,
        provider: { name: key.provider.name },
        health: key.health,
        initialBalance: key.initialBalance ? Number(key.initialBalance) : null,
        burnRate: key.burnRate ? Number(key.burnRate) : null,
      },
      usage: {
        totalCost: Math.round(totalCost * 1000000) / 1000000,
        totalCalls,
        totalTokensIn,
        totalTokensOut,
      },
      byAgent,
      dailyTrend,
      failoverCount,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[keys/id/usage] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}