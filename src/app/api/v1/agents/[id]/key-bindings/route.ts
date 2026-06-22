import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import { updateKeyBindingsSchema, validate, ValidationError, formatValidationErrors } from "@/lib/validation";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface KeyBindingInput {
  keyId: string;
  priority: number;
  status?: string;
}

interface KeyBindingResponse {
  id: string;
  keyId: string;
  keyLabel: string;
  provider: { id: string; name: string; displayName: string };
  protocol: string;
  priority: number;
  status: string;
}

// ──────────────────────────────────────────────
// GET /api/v1/agents/:agentId/key-bindings
// List all key bindings for an agent, sorted by priority
// ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id: agentId } = await params;

    // ── Verify agent exists and belongs to user ──
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

    // ── Fetch bindings ─────────────────────────
    const bindings = await prisma.keyBinding.findMany({
      where: { agentId },
      include: {
        key: {
          select: {
            id: true,
            keyLabel: true,
            protocol: true,
            provider: {
              select: { id: true, name: true, displayName: true },
            },
          },
        },
      },
      orderBy: { priority: "asc" },
    });

    const result: KeyBindingResponse[] = bindings.map((b) => ({
      id: b.id,
      keyId: b.key.id,
      keyLabel: b.key.keyLabel,
      provider: {
        id: b.key.provider.id,
        name: b.key.provider.name,
        displayName: b.key.provider.displayName,
      },
      protocol: b.key.protocol,
      priority: b.priority,
      status: b.status,
    }));

    return NextResponse.json({ bindings: result }, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[agents/id/key-bindings] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────
// PUT /api/v1/agents/:agentId/key-bindings
// Full replacement of key bindings for an agent
// ──────────────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id: agentId } = await params;

    // ── Verify agent exists and belongs to user ──
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

    // ── Parse body ─────────────────────────────
    const body = await request.json();
    const { bindings } = validate(updateKeyBindingsSchema, body);

    // ── Validate all keyIds belong to this user ─
    const keyIds = [...new Set(bindings.map((b) => b.keyId))];
    const ownedKeys = await prisma.key.findMany({
      where: { id: { in: keyIds }, accountId: user.id },
      select: { id: true },
    });
    const ownedKeyIds = new Set(ownedKeys.map((k) => k.id));

    for (const binding of bindings) {
      if (!ownedKeyIds.has(binding.keyId)) {
        return NextResponse.json(
          { code: "VALIDATION_ERROR", message: `Key ${binding.keyId} not found or not owned` },
          { status: 400 }
        );
      }
    }

    // ── Replace bindings in a transaction ──────
    await prisma.$transaction(async (tx) => {
      // Delete all existing bindings for this agent
      await tx.keyBinding.deleteMany({ where: { agentId } });

      // Create new bindings
      await Promise.all(
        bindings.map((b) =>
          tx.keyBinding.create({
            data: {
              agentId,
              keyId: b.keyId,
              priority: b.priority,
              status: (b.status ?? "active") as "active" | "standby" | "depleted" | "failed",
            },
          })
        )
      );
    });

    // Re-fetch with includes (avoids $transaction type inference issue)
    const newBindings = await prisma.keyBinding.findMany({
      where: { agentId },
      include: {
        key: {
          select: {
            id: true,
            keyLabel: true,
            protocol: true,
            provider: {
              select: { id: true, name: true, displayName: true },
            },
          },
        },
      },
      orderBy: { priority: "asc" },
    });

    const result: KeyBindingResponse[] = newBindings.map((b) => ({
      id: b.id,
      keyId: b.key.id,
      keyLabel: b.key.keyLabel,
      provider: {
        id: b.key.provider.id,
        name: b.key.provider.name,
        displayName: b.key.provider.displayName,
      },
      protocol: b.key.protocol,
      priority: b.priority,
      status: b.status,
    }));

    return NextResponse.json({ bindings: result }, { status: 200 });
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

    console.error("[agents/id/key-bindings] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}