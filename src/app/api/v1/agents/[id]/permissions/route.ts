import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import { updatePermissionSchema, validate, ValidationError, formatValidationErrors } from "@/lib/validation";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

const DEFAULT_RULES: Record<string, string> = {
  edit: "ask",
  bash: "ask",
  read: "allow",
  webfetch: "ask",
  write: "ask",
};

// ──────────────────────────────────────────────
// GET /api/v1/agents/:agentId/permissions
// Get an agent's permission configuration
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
      select: { accountId: true, safetyMode: true },
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

    // ── Fetch or return defaults ───────────────
    const permission = await prisma.permission.findUnique({
      where: { agentId },
    });

    if (!permission) {
      return NextResponse.json(
        {
          rules: DEFAULT_RULES,
          safetyMode: agent.safetyMode,
          version: 1,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        rules: (permission.rules as Record<string, unknown>) ?? DEFAULT_RULES,
        safetyMode: permission.safetyMode,
        version: permission.version,
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

    console.error("[agents/id/permissions] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────
// PATCH /api/v1/agents/:agentId/permissions
// Update an agent's permission rules
// ──────────────────────────────────────────────

export async function PATCH(
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
    const { rules, safetyMode } = validate(updatePermissionSchema, body);

    // ── Upsert permission ──────────────────────
    // Merge rules into existing rules if present
    const existing = await prisma.permission.findUnique({
      where: { agentId },
    });

    const mergedRules = rules
      ? { ...((existing?.rules as Record<string, unknown>) ?? DEFAULT_RULES), ...rules }
      : undefined;

    const permission = await prisma.permission.upsert({
      where: { agentId },
      create: {
        agentId,
        rules: (mergedRules ?? DEFAULT_RULES) as any,
        safetyMode: safetyMode ?? false,
        version: 1,
      },
      update: {
        ...(mergedRules !== undefined ? { rules: mergedRules as any } : {}),
        ...(safetyMode !== undefined ? { safetyMode } : {}),
        version: { increment: 1 },
      },
    });

    return NextResponse.json(
      {
        rules: permission.rules as Record<string, unknown>,
        safetyMode: permission.safetyMode,
        version: permission.version,
      },
      { status: 200 }
    );
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

    console.error("[agents/id/permissions] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}