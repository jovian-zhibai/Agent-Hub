import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import { validate, ValidationError, formatValidationErrors, updateAgentSchema, uuidSchema } from "@/lib/validation";

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

// B10: UTC date helpers (consistent with dashboard/cost-trend)
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id } = await params;

    try {
      validate(uuidSchema, id);
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json(
          { code: "VALIDATION_ERROR", message: "Invalid ID format" },
          { status: 400 }
        );
      }
      throw e;
    }

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

    // ── Compute stats from aggregation table ────
    // B4: Use TelemetryDaily instead of scanning raw telemetry_logs
    const todayAgg = await prisma.telemetryDaily.aggregate({
      where: { agentId: id, day: { equals: todayStartUTC() } },
      _sum: { toolCalls: true, permissionsDenied: true },
    });

    const monthAgg = await prisma.telemetryDaily.aggregate({
      where: { agentId: id, day: { gte: monthStartUTC() } },
      _sum: { toolCalls: true, cost: true, permissionsDenied: true },
    });

    const todayCalls = todayAgg._sum.toolCalls ?? 0;
    // B3: monthlyCost from agent.monthlySpent (maintained by budget engine)
    const monthlyCost = Number(agent.monthlySpent);
    const monthlyToolCalls = monthAgg._sum.toolCalls ?? 0;
    const avgCost = monthlyToolCalls > 0 ? monthlyCost / monthlyToolCalls : 0;

    // Success rate: 1 - (permissionsDenied / toolCalls) for this month
    const deniedCount = monthAgg._sum.permissionsDenied ?? 0;
    const successRate = monthlyToolCalls > 0
      ? Math.max(0, 1 - deniedCount / monthlyToolCalls)
      : 1;

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
        lastUpdated: new Date().toISOString(),
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

// ──────────────────────────────────────────────
// PATCH /api/v1/agents/:id
// Update agent fields (enabled, status, name, etc.)
// ──────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id } = await params;

    try {
      validate(uuidSchema, id);
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json(
          { code: "VALIDATION_ERROR", message: "Invalid ID format" },
          { status: 400 }
        );
      }
      throw e;
    }

    const body = await request.json();

    // Verify agent exists and belongs to current user
    const agent = await prisma.agent.findUnique({ where: { id } });
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

    // B11: Use zod validation instead of manual field extraction
    const data = validate(updateAgentSchema, body);

    const updateData: Record<string, unknown> = { ...data };
    if (data.enabled === false) {
      updateData.disabledReason = "manual";
    } else if (data.enabled === true) {
      updateData.disabledReason = null;
    }

    const updated = await prisma.agent.update({
      where: { id },
      data: updateData as any,
    });

    return NextResponse.json({
      id: updated.id,
      enabled: updated.enabled,
      status: updated.status,
    });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: formatValidationErrors(error.errors) },
        { status: 400 }
      );
    }
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[agents/id] PATCH error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
