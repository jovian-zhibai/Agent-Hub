import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// GET /api/v1/agents
// List all agents for the current user with:
//   - Status, model, current key info
//   - Today's call count
//   - Monthly spend (from agent.monthlySpent)
//   - Last heartbeat
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);

    // ── Fetch all agents for this user ─────────
    const agents = await prisma.agent.findMany({
      where: { accountId: user.id },
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
    });

    // ── Compute aggregates from telemetry ──────
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    );

    const agentIds = agents.map((a) => a.id);

    // Batch query: today's call counts
    const todayCallsRaw = await prisma.telemetryLog.groupBy({
      by: ["agentId"],
      where: {
        agentId: { in: agentIds },
        reportedAt: { gte: todayStart },
        eventType: "tool_call",
      },
      _count: { id: true },
    });
    const todayCallsMap = new Map(
      todayCallsRaw.map((r) => [r.agentId, r._count.id])
    );

    // Fetch last heartbeat per agent
    const lastHeartbeats = await prisma.telemetryLog.findMany({
      where: {
        agentId: { in: agentIds },
        eventType: "heartbeat",
      },
      select: {
        agentId: true,
        reportedAt: true,
      },
      orderBy: { reportedAt: "desc" },
      distinct: ["agentId"],
    });
    const heartbeatMap = new Map(
      lastHeartbeats.map((h) => [h.agentId, h.reportedAt.toISOString()])
    );

    // ── Build response ─────────────────────────
    const result = agents.map((agent) => {
      const currentKey = agent.keyBindings[0]?.key ?? null;

      return {
        id: agent.id,
        name: agent.name,
        framework: agent.framework,
        status: agent.status,
        enabled: agent.enabled,
        safetyMode: agent.safetyMode,
        model: null,
        projectName: agent.projectName,
        projectPath: agent.projectPath,
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
        createdAt: agent.createdAt.toISOString(),
      };
    });

    // 按 project 分组
    const groups: Record<string, typeof result> = {};
    for (const agent of result) {
      const key = agent.projectName || "Default";
      if (!groups[key]) groups[key] = [];
      groups[key].push(agent);
    }
    const projects = Object.entries(groups).map(([projectName, agentList]) => ({
      projectName,
      agents: agentList,
    }));

    return NextResponse.json(
      { agents: result, projects, total: result.length, lastUpdated: new Date().toISOString() },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR",
          message: error.message,
        },
        { status: error.statusCode }
      );
    }

    console.error("[agents] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────
// POST /api/v1/agents
// Register a new agent for the current user.
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);
    const body = await request.json();

    // Upsert 逻辑：同一 account + projectPath + name 已存在则更新，否则新增
    const projectPath = body.projectPath || "";
    const projectName = body.projectName || "";

    const existing = await prisma.agent.findFirst({
      where: {
        accountId: user.id,
        projectPath: projectPath,
        name: body.name,
      },
    });

    let agent;
    if (existing) {
      // B13: Don't overwrite status, enabled, or other admin-managed fields
      const updateData: Record<string, any> = {};
      if (body.machineId !== undefined) {
        updateData.machineId = body.machineId;
      } else if (existing.machineId) {
        updateData.machineId = existing.machineId;
      }
      updateData.projectName = projectName || existing.projectName;
      updateData.projectPath = projectPath || existing.projectPath;

      agent = await prisma.agent.update({
        where: { id: existing.id },
        data: updateData,
      });
    } else {
      agent = await prisma.agent.create({
        data: {
          name: body.name,
          framework: body.framework || body.type || "opencode",
          status: "running",
          accountId: user.id,
          machineId: body.machineId ?? null,
          enabled: true,
          projectName: projectName,
          projectPath: projectPath,
        },
      });
    }

    // ── Persist permissions if provided (connect sync) ──
    if (body.permissions && Array.isArray(body.permissions)) {
      const rules: Record<string, string> = {};
      for (const p of body.permissions) {
        rules[p.tool] = p.action;
      }
      await prisma.permission.upsert({
        where: { agentId: agent.id },
        update: { rules: rules as any, version: { increment: 1 } },
        create: { agentId: agent.id, rules: rules as any, version: 1 },
      });
    }

    return NextResponse.json(
      {
        id: agent.id,
        name: agent.name,
        framework: agent.framework,
        status: agent.status,
        machineId: agent.machineId,
        projectName: agent.projectName,
        projectPath: agent.projectPath,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        {
          code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR",
          message: error.message,
        },
        { status: error.statusCode }
      );
    }

    console.error("[agents] POST error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}