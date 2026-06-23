import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface DashboardMetrics {
  agentCount: number;
  agentRunning: number;
  agentError: number;
  keyCount: number;
  keyHealthy: number;
  keyWarning: number;
  totalCostThisMonth: number;
  totalCallsToday: number;
  interceptsToday: number;
}

interface AgentListItem {
  id: string;
  name: string;
  framework: string;
  status: string;
  enabled: boolean;
  safetyMode: boolean;
  model: { modelName: string; displayName: string } | null;
  currentKey: { keyId: string; keyLabel: string; provider: { name: string } } | null;
  todayCalls: number;
  monthlyCost: number;
  lastHeartbeat: string | null;
  projectName: string;
  projectPath: string;
}

interface CostTrendPoint {
  date: string;
  cost: number;
}

interface KeyOverviewItem {
  id: string;
  keyLabel: string;
  provider: { name: string };
  health: string;
  remaining: number | null;
  spent: number;
  burnRate: number | null;
}

interface DashboardResponse {
  lastUpdated: string;
  metrics: DashboardMetrics;
  agentList: AgentListItem[];
  projects: { projectName: string; agents: AgentListItem[] }[];
  costTrend: CostTrendPoint[];
  keyOverview: KeyOverviewItem[];
}

// ──────────────────────────────────────────────
// UTC Date Helpers (B10: unify timezone to UTC)
// ──────────────────────────────────────────────

function utcDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function todayStartUTC(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function monthStartUTC(): Date {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function daysAgoUTC(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

// ──────────────────────────────────────────────
// GET /api/v1/dashboard
// 返回仪表盘首页需要的全部数据
// B4: reads TelemetryDaily aggregation table instead of
//     scanning raw telemetry_logs (O(1) vs O(N) per load)
// B10: all date buckets use UTC for consistency with ingest
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    const accountId = user.id;

    // ── Parallel queries for metrics ──────────
    const [
      agentCounts,
      keyCounts,
      monthlyCostAgg,
      todayAgg,
      agents,
      keys,
      costTrendDaily,
    ] = await Promise.all([
      // Agent counts
      prisma.agent.groupBy({
        by: ["status"],
        where: { accountId },
        _count: { id: true },
      }),

      // Key counts
      prisma.key.groupBy({
        by: ["health"],
        where: { accountId },
        _count: { id: true },
      }),

      // B4: Monthly cost from aggregation table (not raw logs)
      prisma.telemetryDaily.aggregate({
        where: {
          agent: { accountId },
          day: { gte: monthStartUTC() },
        },
        _sum: { cost: true },
      }),

      // B4: Today's calls + intercepts from aggregation table
      prisma.telemetryDaily.aggregate({
        where: {
          agent: { accountId },
          day: { equals: todayStartUTC() },
        },
        _sum: { toolCalls: true, permissionsDenied: true },
      }),

      // Agent list with key bindings
      prisma.agent.findMany({
        where: { accountId },
        include: {
          keyBindings: {
            include: {
              key: {
                select: {
                  id: true,
                  keyLabel: true,
                  provider: { select: { name: true } },
                },
              },
            },
            orderBy: { priority: "asc" },
            take: 1,
          },
        },
        orderBy: [{ projectName: "asc" }, { createdAt: "desc" }],
      }),

      // Key overview — include currentBalance + spent for accurate display
      prisma.key.findMany({
        where: { accountId },
        select: {
          id: true,
          keyLabel: true,
          health: true,
          currentBalance: true,
          initialBalance: true,
          spent: true,
          burnRate: true,
          provider: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),

      // B4: 7-day cost trend from aggregation table
      prisma.telemetryDaily.findMany({
        where: {
          agent: { accountId },
          day: { gte: daysAgoUTC(7) },
        },
        orderBy: { day: "asc" },
        select: { day: true, cost: true },
      }),
    ]);

    // ── Build metrics ─────────────────────────
    let agentRunning = 0;
    let agentError = 0;
    for (const row of agentCounts) {
      if (row.status === "running") agentRunning = row._count.id;
      if (row.status === "error") agentError = row._count.id;
    }
    const agentCount = agentCounts.reduce((sum, r) => sum + r._count.id, 0);

    let keyHealthy = 0;
    let keyWarning = 0;
    for (const row of keyCounts) {
      if (row.health === "normal") keyHealthy = row._count.id;
      if (row.health === "warning") keyWarning = row._count.id;
    }
    const keyCount = keyCounts.reduce((sum, r) => sum + r._count.id, 0);

    const totalCostThisMonth = Number(monthlyCostAgg._sum.cost ?? 0);
    const totalCallsToday = todayAgg._sum.toolCalls ?? 0;
    const interceptsToday = todayAgg._sum.permissionsDenied ?? 0;

    // ── Build agent list ──────────────────────
    const agentIds = agents.map((a) => a.id);

    // B4: per-agent today calls from aggregation table
    const todayCallsDaily = await prisma.telemetryDaily.findMany({
      where: {
        agentId: { in: agentIds },
        day: { equals: todayStartUTC() },
      },
      select: { agentId: true, toolCalls: true },
    });
    const todayCallsMap = new Map(
      todayCallsDaily.map((r) => [r.agentId, r.toolCalls])
    );

    // Last heartbeat per agent (still from raw logs — no aggregate for this)
    const lastHeartbeats = await prisma.telemetryLog.findMany({
      where: {
        agentId: { in: agentIds },
        eventType: "heartbeat",
      },
      select: { agentId: true, reportedAt: true },
      orderBy: { reportedAt: "desc" },
      distinct: ["agentId"],
    });
    const heartbeatMap = new Map(
      lastHeartbeats.map((h) => [h.agentId, h.reportedAt.toISOString()])
    );

    const agentList: AgentListItem[] = agents.map((agent) => {
      const currentKey = agent.keyBindings[0]?.key ?? null;

      return {
        id: agent.id,
        name: agent.name,
        framework: agent.framework,
        status: agent.status,
        enabled: agent.enabled,
        safetyMode: agent.safetyMode,
        model: null,
        projectName: agent.projectName ?? "",
        projectPath: agent.projectPath ?? "",
        currentKey: currentKey
          ? {
              keyId: currentKey.id,
              keyLabel: currentKey.keyLabel,
              provider: { name: currentKey.provider.name },
            }
          : null,
        todayCalls: todayCallsMap.get(agent.id) ?? 0,
        monthlyCost: Number(agent.monthlySpent),
        lastHeartbeat: heartbeatMap.get(agent.id) ?? null,
      };
    });

    // ── Build cost trend (last 7 days from aggregate) ───
    const costTrend: CostTrendPoint[] = costTrendDaily.map((row) => ({
      date: utcDateKey(row.day),
      cost: Math.round(Number(row.cost) * 1000000) / 1000000,
    }));

    // ── Build key overview ────────────────────
    // B3 fix: use currentBalance (live remaining) not initialBalance
    const keyOverview: KeyOverviewItem[] = keys.map((key) => ({
      id: key.id,
      keyLabel: key.keyLabel,
      provider: { name: key.provider.name },
      health: key.health,
      remaining: key.currentBalance !== null
        ? Number(key.currentBalance)
        : key.initialBalance !== null
          ? Number(key.initialBalance)
          : null,
      spent: Number(key.spent),
      burnRate: key.burnRate ? Number(key.burnRate) : null,
    }));

    // ── Build projects grouping ───────────────
    const groups: Record<string, AgentListItem[]> = {};
    for (const agent of agentList) {
      const key = agent.projectName || "Default";
      if (!groups[key]) groups[key] = [];
      groups[key].push(agent);
    }
    const projects = Object.entries(groups).map(([projectName, projectAgents]) => ({
      projectName,
      agents: projectAgents,
    }));

    // ── Compose response ──────────────────────
    const response: DashboardResponse = {
      lastUpdated: new Date().toISOString(),
      metrics: {
        agentCount,
        agentRunning,
        agentError,
        keyCount,
        keyHealthy,
        keyWarning,
        totalCostThisMonth: Math.round(totalCostThisMonth * 1000000) / 1000000,
        totalCallsToday,
        interceptsToday,
      },
      agentList,
      projects,
      costTrend,
      keyOverview,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[dashboard] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
