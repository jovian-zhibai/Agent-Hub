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
  burnRate: number | null;
}

interface DashboardResponse {
  metrics: DashboardMetrics;
  agentList: AgentListItem[];
  projects: { projectName: string; agents: AgentListItem[] }[];
  costTrend: CostTrendPoint[];
  keyOverview: KeyOverviewItem[];
}

interface TokenUsagePayload {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  tokensIn?: number;
  tokensOut?: number;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function monthStart(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ──────────────────────────────────────────────
// GET /api/v1/dashboard
// 返回仪表盘首页需要的全部数据
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    const accountId = user.id;

    // ── Parallel queries for metrics ──────────
    const [
      agentCounts,
      keyCounts,
      monthlyCostEvents,
      todayCallsCount,
      interceptsTodayCount,
      agents,
      keys,
      costTrendEvents,
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

      // Monthly cost (token_usage events this month)
      prisma.telemetryLog.findMany({
        where: {
          accountId,
          eventType: "token_usage",
          reportedAt: { gte: monthStart() },
        },
        select: { payload: true },
      }),

      // Today's tool calls
      prisma.telemetryLog.count({
        where: {
          accountId,
          eventType: "tool_call",
          reportedAt: { gte: todayStart() },
        },
      }),

      // Today's intercepts (permission denied)
      prisma.telemetryLog.count({
        where: {
          accountId,
          eventType: "permission_denied",
          reportedAt: { gte: todayStart() },
        },
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

      // Key overview
      prisma.key.findMany({
        where: { accountId },
        include: {
          provider: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
      }),

      // Cost trend (last 7 days token_usage)
      prisma.telemetryLog.findMany({
        where: {
          accountId,
          eventType: "token_usage",
          reportedAt: { gte: daysAgo(7) },
        },
        select: { payload: true, reportedAt: true },
        orderBy: { reportedAt: "asc" },
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

    // ── Load models pricing ───────────────────
    const allModels = await prisma.model.findMany({
      where: { isActive: true },
      select: {
        modelName: true,
        displayName: true,
        pricingInput: true,
        pricingOutput: true,
      },
    });
    const pricingMap = new Map<
      string,
      { displayName: string; pricingInput: number; pricingOutput: number }
    >();
    for (const m of allModels) {
      if (!pricingMap.has(m.modelName)) {
        pricingMap.set(m.modelName, {
          displayName: m.displayName,
          pricingInput: Number(m.pricingInput),
          pricingOutput: Number(m.pricingOutput),
        });
      }
    }

    // ── Calculate monthly cost ────────────────
    let totalCostThisMonth = 0;
    for (const event of monthlyCostEvents) {
      const payload = event.payload as TokenUsagePayload;
      const model = payload.model ?? "unknown";
      const tokensIn = (payload.tokensIn as number) || (payload.promptTokens as number) || 0;
      const tokensOut = (payload.tokensOut as number) || (payload.completionTokens as number) || 0;
      const pricing = pricingMap.get(model);
      if (pricing) {
        totalCostThisMonth +=
          (tokensIn * pricing.pricingInput + tokensOut * pricing.pricingOutput) / 1_000_000;
      }
    }

    // ── Build agent list ──────────────────────
    const agentIds = agents.map((a) => a.id);

    // Batch query today's calls per agent
    const todayCallsRaw = await prisma.telemetryLog.groupBy({
      by: ["agentId"],
      where: {
        agentId: { in: agentIds },
        reportedAt: { gte: todayStart() },
        eventType: "tool_call",
      },
      _count: { id: true },
    });
    const todayCallsMap = new Map(
      todayCallsRaw.map((r) => [r.agentId, r._count.id])
    );

    // Last heartbeat per agent
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

    // ── Build cost trend (last 7 days) ────────
    const dayMap = new Map<string, number>();
    for (const event of costTrendEvents) {
      const payload = event.payload as TokenUsagePayload;
      const day = dateKey(event.reportedAt);
      const model = payload.model ?? "unknown";
      const tokensIn = (payload.tokensIn as number) || (payload.promptTokens as number) || 0;
      const tokensOut = (payload.tokensOut as number) || (payload.completionTokens as number) || 0;
      const pricing = pricingMap.get(model);
      let cost = 0;
      if (pricing) {
        cost = (tokensIn * pricing.pricingInput + tokensOut * pricing.pricingOutput) / 1_000_000;
      }
      dayMap.set(day, (dayMap.get(day) ?? 0) + cost);
    }

    const sortedDays = Array.from(dayMap.keys()).sort();
    const costTrend: CostTrendPoint[] = sortedDays.map((date) => ({
      date,
      cost: Math.round(dayMap.get(date)! * 1000000) / 1000000,
    }));

    // ── Build key overview ────────────────────
    const keyOverview: KeyOverviewItem[] = keys.map((key) => ({
      id: key.id,
      keyLabel: key.keyLabel,
      provider: { name: key.provider.name },
      health: key.health,
      remaining: key.initialBalance ? Number(key.initialBalance) : null,
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
      metrics: {
        agentCount,
        agentRunning,
        agentError,
        keyCount,
        keyHealthy,
        keyWarning,
        totalCostThisMonth: Math.round(totalCostThisMonth * 1000000) / 1000000,
        totalCallsToday: todayCallsCount,
        interceptsToday: interceptsTodayCount,
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