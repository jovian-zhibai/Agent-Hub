import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import { uuidSchema, validate, ValidationError } from "@/lib/validation";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface ExportDay {
  day: string;            // "2024-01-15"
  tokensInput: number;
  tokensOutput: number;
  cost: number;
  toolCalls: number;
}

interface ExportTotals {
  tokensInput: number;
  tokensOutput: number;
  cost: number;
  toolCalls: number;
}

interface ExportJsonResponse {
  agentId: string;
  range: string;
  exportedAt: string;
  days: ExportDay[];
  totals: ExportTotals;
}

// ──────────────────────────────────────────────
// UTC Helpers (B10: unify timezone to UTC)
// ──────────────────────────────────────────────

function utcDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function computeStartDateUTC(range: string | null): Date {
  const days = range === "30d" ? 30 : 7;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function roundCost(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}

// ──────────────────────────────────────────────
// GET /api/v1/agents/:id/export?format=csv|json&range=7d|30d
// Exports telemetry daily aggregates as CSV or JSON.
// B4: reads TelemetryDaily aggregation table (not raw logs)
// B10: UTC date buckets consistent with ingest
// ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id: agentId } = await params;

    try {
      validate(uuidSchema, agentId);
    } catch (e) {
      if (e instanceof ValidationError) {
        return NextResponse.json(
          { code: "VALIDATION_ERROR", message: "Invalid ID format" },
          { status: 400 }
        );
      }
      throw e;
    }

    // ── Verify agent belongs to user ──────────
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

    const { searchParams } = new URL(request.url);
    const formatParam = searchParams.get("format");
    const rangeParam = searchParams.get("range");

    const format = formatParam === "csv" ? "csv" : "json";
    const range = rangeParam === "30d" ? "30d" : "7d";

    const startDate = computeStartDateUTC(range);

    // B4: read from aggregation table instead of scanning raw logs
    const dailyData = await prisma.telemetryDaily.findMany({
      where: {
        agentId,
        day: { gte: startDate },
      },
      orderBy: { day: "asc" },
      select: {
        day: true,
        tokensInput: true,
        tokensOutput: true,
        cost: true,
        toolCalls: true,
      },
    });

    // ── Map rows to export shape ───────────────
    // BigInt → Number for JSON (daily aggregates stay within safe range)
    // Decimal → Number rounded to 6 decimal places
    const days: ExportDay[] = dailyData.map((row) => ({
      day: utcDateKey(row.day),
      tokensInput: Number(row.tokensInput),
      tokensOutput: Number(row.tokensOutput),
      cost: roundCost(Number(row.cost)),
      toolCalls: row.toolCalls,
    }));

    const totals: ExportTotals = {
      tokensInput: days.reduce((s, d) => s + d.tokensInput, 0),
      tokensOutput: days.reduce((s, d) => s + d.tokensOutput, 0),
      cost: roundCost(days.reduce((s, d) => s + d.cost, 0)),
      toolCalls: days.reduce((s, d) => s + d.toolCalls, 0),
    };

    const exportedAt = new Date().toISOString();

    // ── CSV response ──────────────────────────
    if (format === "csv") {
      const header = "day,tokensInput,tokensOutput,cost,toolCalls";
      const lines = days.map((d) =>
        [
          d.day,
          d.tokensInput.toString(),
          d.tokensOutput.toString(),
          d.cost.toString(),
          d.toolCalls.toString(),
        ].join(",")
      );
      // Totals row: empty day field
      lines.push(
        [
          "",
          totals.tokensInput.toString(),
          totals.tokensOutput.toString(),
          totals.cost.toString(),
          totals.toolCalls.toString(),
        ].join(",")
      );

      const csv = [header, ...lines].join("\n");

      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="agent-${agentId}-${range}.csv"`,
        },
      });
    }

    // ── JSON response ────────────────────────
    const body: ExportJsonResponse = {
      agentId,
      range,
      exportedAt,
      days,
      totals,
    };

    return NextResponse.json(body, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[agents/id/export] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
