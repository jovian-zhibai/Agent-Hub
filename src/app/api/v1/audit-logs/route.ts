import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import {
  paginationSchema,
  validate,
  ValidationError,
  formatValidationErrors,
} from "@/lib/validation";

// ──────────────────────────────────────────────
// GET /api/v1/audit-logs
// List audit logs for the current user with filters + pagination.
//
// Query params:
//   page        (default 1)   — page number
//   limit       (default 20)  — page size, max 100
//   action      (optional)    — filter by action string
//   targetType  (optional)    — filter by target type (agent / key / workspace)
//   targetId    (optional)    — filter by target ID
//   from        (optional)    — ISO date string, createdAt >= from
//   to          (optional)    — ISO date string, createdAt <= to
//
// Security: only returns logs where accountId === user.id
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);

    // ── Parse query params ───────────────────
    const { searchParams } = new URL(request.url);

    const { page, limit } = validate(paginationSchema, {
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    const action = searchParams.get("action");
    const targetType = searchParams.get("targetType");
    const targetId = searchParams.get("targetId");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    // ── Build where clause ───────────────────
    // Security: always scope to the current user's account.
    const where: Record<string, unknown> = { accountId: user.id };

    if (action) where.action = action;
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = targetId;

    const createdAt: Record<string, Date> = {};
    if (from) {
      const fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) {
        return NextResponse.json(
          { code: "VALIDATION_ERROR", message: "Invalid 'from' date format" },
          { status: 400 }
        );
      }
      createdAt.gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      if (isNaN(toDate.getTime())) {
        return NextResponse.json(
          { code: "VALIDATION_ERROR", message: "Invalid 'to' date format" },
          { status: 400 }
        );
      }
      createdAt.lte = toDate;
    }
    if (Object.keys(createdAt).length > 0) {
      where.createdAt = createdAt;
    }

    // ── Fetch logs + total count in parallel ─
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: where as any,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where: where as any }),
    ]);

    // ── Build response ───────────────────────
    const result = logs.map((log) => ({
      id: log.id,
      action: log.action,
      operatorId: log.operatorId,
      targetType: log.targetType,
      targetId: log.targetId,
      details: log.details,
      createdAt: log.createdAt.toISOString(),
    }));

    return NextResponse.json(
      {
        logs: result,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
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
        {
          code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR",
          message: error.message,
        },
        { status: error.statusCode }
      );
    }

    console.error("[audit-logs] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
