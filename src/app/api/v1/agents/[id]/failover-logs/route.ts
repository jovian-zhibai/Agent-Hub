import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import {
  uuidSchema,
  paginationSchema,
  validate,
  ValidationError,
  formatValidationErrors,
} from "@/lib/validation";

// ──────────────────────────────────────────────
// GET /api/v1/agents/:id/failover-logs
// Returns all failover logs for an agent.
// ──────────────────────────────────────────────

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

    // ── Verify agent ownership ────────────────
    const agent = await prisma.agent.findUnique({
      where: { id },
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

    // ── Parse pagination params ────────────────
    const { searchParams } = new URL(request.url);
    const { page, limit } = validate(paginationSchema, {
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    // ── Fetch failover logs (paginated) ────────
    const [failoverLogs, total] = await Promise.all([
      prisma.failoverLog.findMany({
        where: { agentId: id },
        include: {
          fromKey: { select: { id: true, keyLabel: true } },
          toKey: { select: { id: true, keyLabel: true } },
        },
        orderBy: { triggeredAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.failoverLog.count({ where: { agentId: id } }),
    ]);

    const logs = failoverLogs.map((fl) => ({
      id: fl.id,
      timestamp: fl.triggeredAt.toISOString(),
      fromKey: fl.fromKey?.keyLabel ?? null,
      toKey: fl.toKey?.keyLabel ?? null,
      reason: fl.reason,
    }));

    return NextResponse.json({
      logs,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }, { status: 200 });
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

    console.error("[agents/id/failover-logs] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}