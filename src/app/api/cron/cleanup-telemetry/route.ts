import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

// ──────────────────────────────────────────────
// GET /api/cron/cleanup-telemetry
//
// Prune old rows from telemetry_logs to keep the raw-event table
// bounded. Aggregated rollups (telemetry_hourly / telemetry_daily)
// are kept indefinitely so historical cost trends survive.
//
// Default retention: 90 days. Override with RETENTION_DAYS env var.
// Should run daily. Called by Vercel Cron (see vercel.json) or any
// external scheduler via:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//        https://your-host/api/cron/cleanup-telemetry
//
// The standalone script scripts/cleanup-telemetry.mjs does the
// same thing via raw pg for non-Vercel deployments.
//
// Auth: CRON_SECRET env var must be set; the request must carry it
// as `Authorization: Bearer <secret>`.
// ──────────────────────────────────────────────

const DEFAULT_RETENTION_DAYS = 90;
const BATCH_SIZE = 5000;

export async function GET(request: NextRequest) {
  // ── Auth: verify CRON_SECRET ───────────────
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[cron/cleanup-telemetry] CRON_SECRET is not set");
    return NextResponse.json(
      { code: "NOT_CONFIGURED", message: "CRON_SECRET env var is not set" },
      { status: 500 },
    );
  }

  const expected = Buffer.from(`Bearer ${cronSecret}`, "utf8");
  const actual = Buffer.from(authHeader ?? "", "utf8");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Invalid or missing authorization" },
      { status: 401 },
    );
  }

  try {
    const retentionDays = Number.parseInt(
      process.env.RETENTION_DAYS ?? String(DEFAULT_RETENTION_DAYS),
      10,
    );

    if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
      return NextResponse.json(
        {
          code: "VALIDATION_ERROR",
          message: `RETENTION_DAYS must be a positive integer, got "${process.env.RETENTION_DAYS}"`,
        },
        { status: 500 },
      );
    }

    // ── Prune old telemetry logs in batches ──
    // Batched deletion avoids a single huge transaction that would
    // lock the table and spike DB memory.
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    let totalDeleted = 0;

    for (;;) {
      // Find a batch of old rows to delete
      const oldRows = await prisma.telemetryLog.findMany({
        where: { reportedAt: { lt: cutoff } },
        select: { id: true },
        take: BATCH_SIZE,
        orderBy: { reportedAt: "asc" },
      });

      if (oldRows.length === 0) break;

      const deleteResult = await prisma.telemetryLog.deleteMany({
        where: { id: { in: oldRows.map((r) => r.id) } },
      });

      totalDeleted += deleteResult.count;

      if (deleteResult.count < BATCH_SIZE) break;
    }

    console.log(
      `[cron/cleanup-telemetry] Pruned ${totalDeleted} telemetry_log row(s) older than ${retentionDays} day(s)`,
    );

    return NextResponse.json(
      {
        code: "OK",
        deleted: totalDeleted,
        retentionDays,
        cutoff: cutoff.toISOString(),
        cleanedAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[cron/cleanup-telemetry] Failed:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Failed to cleanup telemetry" },
      { status: 500 },
    );
  }
}
