import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/prisma";

// ──────────────────────────────────────────────
// GET /api/cron/reset-monthly-spent
//
// B2: Reset every agent's monthlySpent to 0. Should run on the 1st
// of each month. Called by Vercel Cron (see vercel.json) or any
// external scheduler via:
//
//   curl -H "Authorization: Bearer $CRON_SECRET" \
//        https://your-host/api/cron/reset-monthly-spent
//
// The standalone script scripts/reset-monthly-spent.mjs does the
// same thing via raw pg for non-Vercel deployments.
//
// Auth: CRON_SECRET env var must be set; the request must carry it
// as `Authorization: Bearer <secret>`. This prevents external abuse
// while letting Vercel Cron call it freely.
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // ── Auth: verify CRON_SECRET ───────────────
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[cron/reset-monthly-spent] CRON_SECRET is not set");
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
    // ── Reset monthlySpent for all agents ────
    // Also re-enable agents that were auto-disabled by budget
    // enforcement (B1) so they get a fresh start each month.
    const result = await prisma.agent.updateMany({
      where: {},
      data: {
        monthlySpent: 0,
      },
    });

    console.log(
      `[cron/reset-monthly-spent] Reset monthlySpent for ${result.count} agent(s)`,
    );

    return NextResponse.json(
      {
        code: "OK",
        reset: result.count,
        resetAt: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[cron/reset-monthly-spent] Failed:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Failed to reset monthly spent" },
      { status: 500 },
    );
  }
}
