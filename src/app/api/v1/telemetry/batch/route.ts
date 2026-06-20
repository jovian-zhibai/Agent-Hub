import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, verifyAgentToken, ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// POST /api/v1/telemetry/batch
// Batch ingest telemetry events from DataReporter
// (30s batch interval — do not reject individual events)
// ──────────────────────────────────────────────

interface TelemetryEventInput {
  agentId: string;
  keyId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export async function POST(request: NextRequest) {
  try {
    // ── Dual-mode auth: userToken (dashboard) or agentToken (SDK) ──
    let userId: string;
    let isAgentAuth = false;

    // Try agent token first (SDK / CLI calls)
    const agentUserId = verifyAgentToken(request);
    if (agentUserId) {
      userId = agentUserId;
      isAgentAuth = true;
    } else {
      // Fall back to user token (dashboard calls)
      const user = await getAuthUser(request);
      userId = user.id;
    }

    const body = await request.json();
    const { events } = body as { events?: TelemetryEventInput[] };

    if (!events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "events array is required" },
        { status: 400 }
      );
    }

    // ── Resolve valid agent IDs for this user ──
    // For agent auth, skip strict agent ownership check (agentId in payload
    // is treated as self-reported); for user auth, verify ownership.
    let userAgentIds: Set<string>;

    if (isAgentAuth) {
      // Agent auth: accept events without strict ownership verification
      userAgentIds = new Set(events.filter((e) => e.agentId).map((e) => e.agentId));
    } else {
      userAgentIds = new Set(
        (
          await prisma.agent.findMany({
            where: { accountId: userId },
            select: { id: true },
          })
        ).map((a) => a.id),
      );
    }

    // ── Bulk insert telemetry events ───────────
    // We batch-write all events that have a valid agentId,
    // never rejecting individual events (batch-level commitment).
    const validEvents = events.filter((e) => userAgentIds.has(e.agentId));

    if (validEvents.length > 0) {
      await prisma.telemetryLog.createMany({
        data: validEvents.map((e) => ({
          agentId: e.agentId,
          keyId: e.keyId || null,
          accountId: userId,
          eventType: e.eventType as any,
          payload: (e.payload || {}) as any,
          reportedAt: new Date(e.timestamp || Date.now()),
        })),
        skipDuplicates: true,
      });
    }

    return NextResponse.json(
      { ingested: validEvents.length },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[telemetry/batch] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
