import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// GET /api/v1/agents/:id
// Full agent detail view with:
//   - Agent metadata
//   - Permissions
//   - Key bindings (with provider info)
//   - Recent failover logs (5)
//   - Stats: today calls, monthly cost, avg cost, success rate
//   - Model info
// ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id } = await params;

    // ── Fetch agent with relations ─────────────
    const agent = await prisma.agent.findUnique({
      where: { id },
      include: {
        permission: true,
        keyBindings: {
          include: {
            key: {
              select: {
                id: true,
                keyLabel: true,
                protocol: true,
                providerId: true,
                provider: {
                  select: { id: true, name: true, displayName: true },
                },
              },
            },
          },
          orderBy: { priority: "asc" },
        },
        failoverLogs: {
          include: {
            fromKey: {
              select: { id: true, keyLabel: true },
            },
            toKey: {
              select: { id: true, keyLabel: true },
            },
          },
          orderBy: { triggeredAt: "desc" },
          take: 5,
        },
      },
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

    // ── Compute stats from telemetry ───────────
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Today's tool calls
    const todayCalls = await prisma.telemetryLog.count({
      where: {
        agentId: id,
        reportedAt: { gte: todayStart },
        eventType: "tool_call",
      },
    });

    // ── Load models pricing ───────────────────────
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

    // Monthly token_usage events (for cost extraction)
    const monthlyUsage = await prisma.telemetryLog.findMany({
      where: {
        agentId: id,
        reportedAt: { gte: monthStart },
        eventType: "token_usage",
      },
      select: { payload: true },
    });

    let monthlyCost = 0;
    let costCount = 0;
    for (const entry of monthlyUsage) {
      const payload = entry.payload as Record<string, unknown>;
      const model = typeof payload.model === "string" ? payload.model : "unknown";
      const tokensIn = (payload.tokensIn as number) || (payload.promptTokens as number) || 0;
      const tokensOut = (payload.tokensOut as number) || (payload.completionTokens as number) || 0;

      // Match pricing from models table (reuses same pattern as dashboard/route.ts and cost-trend/route.ts)
      const pricing = pricingMap.get(model);
      if (pricing) {
        monthlyCost += (tokensIn * pricing.pricingInput + tokensOut * pricing.pricingOutput) / 1_000_000;
      }

      if (tokensIn > 0 || tokensOut > 0) costCount++;
    }
    const avgCost = costCount > 0 ? monthlyCost / costCount : 0;

    // Monthly total events (for success rate)
    const monthlyTotal = monthlyUsage.length;
    const successCount = monthlyUsage.filter((e) => {
      const payload = e.payload as Record<string, unknown>;
      return payload.error === undefined || payload.error === null;
    }).length;
    const successRate = monthlyTotal > 0 ? successCount / monthlyTotal : 1;

    // ── Build key bindings response ────────────
    const keyBindings = agent.keyBindings.map((kb) => ({
      keyId: kb.key.id,
      keyLabel: kb.key.keyLabel,
      provider: { name: kb.key.provider.name },
      protocol: kb.key.protocol,
      priority: kb.priority,
      status: kb.status,
    }));

    // ── Build failover logs response ───────────
    const failoverLogs = agent.failoverLogs.map((fl) => ({
      fromKeyId: fl.fromKeyId,
      toKeyId: fl.toKeyId,
      reason: fl.reason,
      triggeredAt: fl.triggeredAt.toISOString(),
    }));

    // ── Resolve model info ────────────────────
    const firstBinding = agent.keyBindings[0];
    let model = null;
    if (firstBinding) {
      const defaultModel = await prisma.model.findFirst({
        where: { providerId: firstBinding.key.providerId, isActive: true },
        select: { modelName: true, displayName: true },
        orderBy: { createdAt: "asc" },
      });
      if (defaultModel) {
        model = {
          modelName: defaultModel.modelName,
          displayName: defaultModel.displayName,
        };
      }
    }

    return NextResponse.json(
      {
        agent: {
          id: agent.id,
          name: agent.name,
          framework: agent.framework,
          status: agent.status,
          enabled: agent.enabled,
          safetyMode: agent.safetyMode,
          machineId: agent.machineId,
          createdAt: agent.createdAt.toISOString(),
          updatedAt: agent.updatedAt.toISOString(),
        },
        permissions: {
          rules: (agent.permission?.rules as Record<string, unknown>) || {},
          safetyMode: agent.permission?.safetyMode ?? agent.safetyMode,
          version: agent.permission?.version ?? 1,
        },
        keyBindings,
        failoverLogs,
        stats: {
          todayCalls,
          monthlyCost,
          avgCost: Math.round(avgCost * 1_000_000) / 1_000_000, // round to 6 decimals
          successRate: Math.round(successRate * 10000) / 10000,
        },
        model,
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[agents/id] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
