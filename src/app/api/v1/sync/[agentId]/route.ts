import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// GET /api/v1/sync/:agentId
// Full sync payload for an agent:
//   - Agent metadata
//   - Permission rules (all deny if agent disabled)
//   - Key bindings
//   - Model info
// ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { agentId } = await params;

    // ── Fetch agent with ownership check ───────
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        permission: true,
        keyBindings: {
          include: {
            key: {
              select: {
                id: true,
                protocol: true,
                keyLabel: true,
                providerId: true,
                provider: {
                  select: {
                    id: true,
                    name: true,
                  },
                },
              },
            },
          },
          orderBy: { priority: "asc" },
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

    // ── Build permissions ──────────────────────
    // If agent is disabled, all permissions are deny
    let permissions: { rules: Record<string, unknown>; safetyMode: boolean; version: number };
    if (!agent.enabled) {
      permissions = { rules: { default: "deny" }, safetyMode: true, version: 0 };
    } else {
      permissions = {
        rules: (agent.permission?.rules as Record<string, unknown>) || {},
        safetyMode: agent.permission?.safetyMode ?? agent.safetyMode,
        version: agent.permission?.version ?? 1,
      };
    }

    // ── Build key bindings ─────────────────────
    const keyBindings = agent.keyBindings.map((kb) => ({
      keyId: kb.key.id,
      provider: kb.key.provider.name,
      protocol: kb.key.protocol,
      priority: kb.priority,
      status: kb.status,
    }));

    // ── Build model info (from first key's provider) ──
    const firstBinding = agent.keyBindings[0];
    let model = null;
    if (firstBinding) {
      const defaultModel = await prisma.model.findFirst({
        where: { providerId: firstBinding.key.providerId, isActive: true },
        select: {
          modelName: true,
          displayName: true,
          defaultProtocol: true,
          supportedProtocols: true,
        },
        orderBy: { createdAt: "asc" },
      });
      if (defaultModel) {
        model = {
          modelName: defaultModel.modelName,
          displayName: defaultModel.displayName,
          defaultProtocol: defaultModel.defaultProtocol,
          supportedProtocols: defaultModel.supportedProtocols as string[],
        };
      }
    }

    return NextResponse.json(
      {
        agent: {
          id: agent.id,
          name: agent.name,
          enabled: agent.enabled,
          safetyMode: agent.safetyMode,
          status: agent.status,
        },
        permissions,
        keyBindings,
        model,
        syncedAt: new Date().toISOString(),
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

    console.error("[sync/agentId] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
