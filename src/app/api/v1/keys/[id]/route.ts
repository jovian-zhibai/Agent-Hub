import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// GET /api/v1/keys/:id
// Return a single key with complete detail info
// ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id } = await params;

    // ── Verify key exists and belongs to user ──
    const existing = await prisma.key.findUnique({
      where: { id },
      include: {
        provider: { select: { id: true, name: true, displayName: true } },
        keyBindings: { select: { agentId: true } },
      },
    });

    if (!existing) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Key not found" },
        { status: 404 }
      );
    }

    if (existing.accountId !== user.id) {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Access denied" },
        { status: 403 }
      );
    }

    const response = {
      id: existing.id,
      keyLabel: existing.keyLabel,
      providerId: existing.providerId,
      provider: {
        id: existing.provider.id,
        name: existing.provider.name,
        displayName: existing.provider.displayName,
      },
      health: existing.health,
      keyValue: undefined,
      baseUrl: undefined,
      scope: existing.scope,
      initialBalance: existing.initialBalance ? Number(existing.initialBalance) : null,
      burnRate: existing.burnRate ? Number(existing.burnRate) : null,
      modelCount: 0,
      agentCount: existing.keyBindings.length,
      createdAt: existing.createdAt.toISOString(),
      label: existing.keyLabel,
    };

    return NextResponse.json({ key: response }, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[keys/id] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────
// PATCH /api/v1/keys/:id
// Update a key's editable fields
// ──────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id } = await params;

    // ── Verify key exists and belongs to user ──
    const existing = await prisma.key.findUnique({
      where: { id },
      select: { accountId: true },
    });

    if (!existing) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Key not found" },
        { status: 404 }
      );
    }

    if (existing.accountId !== user.id) {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Access denied" },
        { status: 403 }
      );
    }

    // ── Parse body ─────────────────────────────
    const body = await request.json();
    const { keyLabel, note, initialBalance, group, isActive } = body as {
      keyLabel?: string;
      note?: string;
      initialBalance?: number;
      group?: string;
      isActive?: boolean;
    };

    // ── Build update data (editable fields only)─
    const updateData: Record<string, unknown> = {};
    if (keyLabel !== undefined) updateData.keyLabel = keyLabel;
    if (note !== undefined) updateData.note = note;
    if (initialBalance !== undefined) updateData.initialBalance = initialBalance;
    if (group !== undefined) updateData.group = group;
    if (isActive !== undefined) updateData.isActive = isActive;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "No updatable fields provided" },
        { status: 400 }
      );
    }

    // ── Update key ─────────────────────────────
    const updated = await prisma.key.update({
      where: { id },
      data: updateData as any,
      include: {
        provider: { select: { id: true, name: true, displayName: true } },
        keyBindings: { select: { id: true } },
      },
    });

    const response = {
      id: updated.id,
      keyLabel: updated.keyLabel,
      provider: {
        id: updated.provider.id,
        name: updated.provider.name,
        displayName: updated.provider.displayName,
      },
      protocol: updated.protocol,
      keyPrefix: updated.keyPrefix,
      scope: updated.scope,
      group: updated.group ?? null,
      note: updated.note ?? null,
      health: updated.health,
      initialBalance: updated.initialBalance ? Number(updated.initialBalance) : null,
      burnRate: updated.burnRate ? Number(updated.burnRate) : null,
      lastTestedAt: updated.lastTestedAt?.toISOString() ?? null,
      isActive: updated.isActive,
      agentCount: updated.keyBindings.length,
      createdAt: updated.createdAt.toISOString(),
    };

    return NextResponse.json({ key: response }, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[keys/id] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────
// DELETE /api/v1/keys/:id
// Delete a key and its associated key bindings
// ──────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id } = await params;

    // ── Verify key exists and belongs to user ──
    const existing = await prisma.key.findUnique({
      where: { id },
      select: { accountId: true },
    });

    if (!existing) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Key not found" },
        { status: 404 }
      );
    }

    if (existing.accountId !== user.id) {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Access denied" },
        { status: 403 }
      );
    }

    // ── Delete key (cascades key_bindings) ──────
    await prisma.key.delete({ where: { id } });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[keys/id] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}