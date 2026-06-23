import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, verifyAgentToken, ApiError } from "@/lib/auth";
import { broadcastEvent } from "@/app/api/v1/events/route";
import { loadPricingMap, computeEventCost } from "@/lib/cost";
import {
  enforceAgentBudget,
  buildBudgetAlert,
  type BudgetAlert,
} from "@/lib/budget";
import { batchTelemetrySchema, validate, ValidationError, formatValidationErrors } from "@/lib/validation";
import { rateLimit, RateLimitPresets } from "@/lib/rate-limit";

const batchLimiter = rateLimit(RateLimitPresets.generous);

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
  eventId?: string; // B7: Deterministic ID for idempotent ingestion
}

export async function POST(request: NextRequest) {
  try {
    const limited = await batchLimiter(request);
    if (limited) return limited;

    // ── Dual-mode auth: userToken (dashboard) or agentToken (SDK) ──
    let userId: string;
    let isAgentAuth = false;

    // Try agent token first (SDK / CLI calls)
    const agentPayload = verifyAgentToken(request);
    if (agentPayload) {
      // S2: Verify tokenVersion against database to support revocation
      const account = await prisma.account.findUnique({
        where: { id: agentPayload.userId },
        select: { tokenVersion: true },
      });
      if (!account || agentPayload.tokenVersion !== account.tokenVersion) {
        return NextResponse.json(
          { code: "AUTH_ERROR", message: "Token has been revoked" },
          { status: 401 },
        );
      }
      userId = agentPayload.userId;
      isAgentAuth = true;
    } else {
      // Fall back to user token (dashboard calls)
      const user = await getAuthUser(request);
      userId = user.id;
    }

    const body = await request.json();
    const { events } = validate(batchTelemetrySchema, body);

    // ── Agent ownership verification ─────────
    // For agent auth (SDK): verify agentId matches the agent token
    // For user auth (dashboard): verify all agentIds belong to the user
    let userAgentIds: Set<string>;

    if (isAgentAuth) {
      // C5: Agent auth — if token has bound agentId, restrict to that agent
      if (agentPayload!.agentId) {
        userAgentIds = new Set([agentPayload!.agentId]);
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

    // ── Idempotent telemetry ingestion ────────
    const validEvents = events.filter((e) => userAgentIds.has(e.agentId));

    // S3: Validate keyId ownership — prevent cross-user balance tampering
    const eventsWithKey = validEvents.filter((e) => e.keyId);
    if (eventsWithKey.length > 0) {
      const userKeyIds = new Set(
        (
          await prisma.key.findMany({
            where: { accountId: userId },
            select: { id: true },
          })
        ).map((k) => k.id),
      );
      // Drop events whose keyId doesn't belong to this user
      for (let i = validEvents.length - 1; i >= 0; i--) {
        const e = validEvents[i];
        if (!e) continue;
        if (e.keyId && !userKeyIds.has(e.keyId)) {
          validEvents.splice(i, 1);
        }
      }
    }

    let ingested = 0;
    const budgetAlerts: BudgetAlert[] = [];

    if (validEvents.length > 0) {
      // S17: Pre-compute eventIds + filter out-of-range timestamps upfront
      const now = Date.now();
      const processed = validEvents
        .map((event) => {
          const eventId =
            event.eventId ||
            `${event.agentId}::${event.timestamp}::${event.eventType}::${String(event.payload?.tool || "unknown")}::${String(event.payload?.model || "unknown")}`;
          const reportedAt = new Date(event.timestamp || Date.now());
          const tsTime = reportedAt.getTime();
          // S11: Skip events with future (>1d) or ancient (>1y) timestamps
          if (tsTime > now + 24 * 60 * 60 * 1000 || tsTime < now - 365 * 24 * 60 * 60 * 1000) {
            return null;
          }
          return { event, eventId, reportedAt };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);

      if (processed.length > 0) {
        // S17: Pre-filter replays in a single query (avoids N findUnique calls)
        const existing = await prisma.telemetryLog.findMany({
          where: { eventId: { in: processed.map((e) => e.eventId) } },
          select: { eventId: true },
        });
        const existingIds = new Set(existing.map((e) => e.eventId));
        const newEvents = processed.filter((e) => !existingIds.has(e.eventId));

        if (newEvents.length > 0) {
          // B1/B3: load pricing once for the entire batch
          const pricingMap =
            newEvents.some((e) => e.event.eventType === "token_usage")
              ? await loadPricingMap(prisma)
              : new Map();

          // S17: Process all new events in a single transaction
          let batchIngested = 0;
          const pendingFailoverLogs: Array<{
            agentId: string;
            fromKeyId: string | null;
            toKeyId: string | null;
            reason: string;
            triggeredAt: Date;
          }> = [];
          await prisma.$transaction(async (tx) => {
            for (const { event, eventId, reportedAt } of newEvents) {
              // S6: Catch P2002 (unique constraint violation) for concurrent duplicates
              try {
                await tx.telemetryLog.create({
                  data: {
                    eventId,
                    agentId: event.agentId,
                    keyId: event.keyId || null,
                    accountId: userId,
                    eventType: event.eventType as any,
                    payload: (event.payload || {}) as any,
                    reportedAt,
                  },
                });
              } catch (err: any) {
                if (err?.code === "P2002") continue; // concurrent duplicate — treat as replay
                throw err;
              }

              // B8: Record key_failover events in FailoverLog table
              if (event.eventType === "key_failover") {
                const payload = event.payload || {};
                const fromKeyId = (payload.fromKeyId || payload.from || "") as string;
                const toKeyId = (payload.toKeyId || payload.to || "") as string;
                const reason = (payload.reason || "unknown") as string;

                if (fromKeyId && toKeyId) {
                  pendingFailoverLogs.push({
                    agentId: event.agentId,
                    fromKeyId: fromKeyId || null,
                    toKeyId: toKeyId || null,
                    reason,
                    triggeredAt: reportedAt,
                  });
                }
              }

              const isTokenUsage = event.eventType === "token_usage";

              // B1/B2: update agent monthlySpent on token usage
              if (isTokenUsage) {
                const { cost, tokensIn, tokensOut } = computeEventCost(event.payload, pricingMap);

                // S4: Use update return value (atomic) instead of read-then-write
                const updatedAgent = await tx.agent.update({
                  where: { id: event.agentId },
                  data: { monthlySpent: { increment: cost } },
                  select: {
                    monthlySpent: true,
                    monthlyBudget: true,
                    enabled: true,
                  },
                });

                const newSpent = Number(updatedAgent.monthlySpent);
                const prevSpent = newSpent - cost;
                const monthlyBudget = updatedAgent.monthlyBudget
                  ? Number(updatedAgent.monthlyBudget)
                  : null;
                const wasEnabled = updatedAgent.enabled;

                // B1: budget enforcement — 80% warning + 100% auto-disable.
                if (monthlyBudget !== null && monthlyBudget > 0) {
                  const budgetResult = await enforceAgentBudget(tx, {
                    agentId: event.agentId,
                    accountId: userId,
                    prevSpent,
                    eventCost: cost,
                    monthlyBudget,
                    wasEnabled,
                    triggeredAt: reportedAt.toISOString(),
                  });

                  const alert = buildBudgetAlert(
                    {
                      agentId: event.agentId,
                      accountId: userId,
                      prevSpent,
                      newSpent,
                      budget: monthlyBudget,
                      triggeredAt: reportedAt.toISOString(),
                    },
                    budgetResult,
                  );
                  if (alert) budgetAlerts.push(alert);
                }

                // B3: key spend tracking — increment spent; decrement currentBalance
                // S5: Use updateMany with gte filter to prevent negative balance
                if (event.keyId) {
                  try {
                    const key = await tx.key.findUnique({
                      where: { id: event.keyId },
                      select: { currentBalance: true },
                    });
                    if (key) {
                      if (key.currentBalance !== null) {
                        const result = await tx.key.updateMany({
                          where: {
                            id: event.keyId,
                            currentBalance: { gte: cost },
                          },
                          data: {
                            spent: { increment: cost },
                            currentBalance: { decrement: cost },
                          },
                        });
                        if (result.count === 0) {
                          await tx.key.update({
                            where: { id: event.keyId },
                            data: { spent: { increment: cost } },
                          });
                        }
                      } else {
                        await tx.key.update({
                          where: { id: event.keyId },
                          data: { spent: { increment: cost } },
                        });
                      }
                    }
                  } catch {
                    // best-effort — key may have been deleted concurrently
                  }
                }

                // B4: upsert hourly/daily aggregation tables
                const hourBucket = new Date(reportedAt);
                hourBucket.setUTCMinutes(0, 0, 0);
                const dayBucket = new Date(reportedAt);
                dayBucket.setUTCHours(0, 0, 0, 0);

                await tx.telemetryHourly.upsert({
                  where: { agentId_hour: { agentId: event.agentId, hour: hourBucket } },
                  create: {
                    agentId: event.agentId,
                    hour: hourBucket,
                    tokensInput: BigInt(tokensIn),
                    tokensOutput: BigInt(tokensOut),
                    cost,
                  },
                  update: {
                    tokensInput: { increment: BigInt(tokensIn) },
                    tokensOutput: { increment: BigInt(tokensOut) },
                    cost: { increment: cost },
                  },
                });

                await tx.telemetryDaily.upsert({
                  where: { agentId_day: { agentId: event.agentId, day: dayBucket } },
                  create: {
                    agentId: event.agentId,
                    day: dayBucket,
                    tokensInput: BigInt(tokensIn),
                    tokensOutput: BigInt(tokensOut),
                    cost,
                  },
                  update: {
                    tokensInput: { increment: BigInt(tokensIn) },
                    tokensOutput: { increment: BigInt(tokensOut) },
                    cost: { increment: cost },
                  },
                });
              } else if (event.eventType === "tool_call") {
                // B4: count tool calls in aggregates (no cost for bare tool_call)
                const hourBucket = new Date(reportedAt);
                hourBucket.setUTCMinutes(0, 0, 0);
                const dayBucket = new Date(reportedAt);
                dayBucket.setUTCHours(0, 0, 0, 0);

                await tx.telemetryHourly.upsert({
                  where: { agentId_hour: { agentId: event.agentId, hour: hourBucket } },
                  create: { agentId: event.agentId, hour: hourBucket, toolCalls: 1 },
                  update: { toolCalls: { increment: 1 } },
                });
                await tx.telemetryDaily.upsert({
                  where: { agentId_day: { agentId: event.agentId, day: dayBucket } },
                  create: { agentId: event.agentId, day: dayBucket, toolCalls: 1 },
                  update: { toolCalls: { increment: 1 } },
                });
              }

              batchIngested++;
            }
          });
          ingested += batchIngested;

          // Create failover logs outside the transaction (best-effort)
          for (const log of pendingFailoverLogs) {
            try {
              await prisma.failoverLog.create({ data: log });
            } catch {
              // Non-critical: failover logging is best-effort
            }
          }

          // ── Broadcast new events to SSE subscribers ──
          for (const { event } of newEvents) {
            const payload = event.payload || {};
            broadcastEvent(userId, event.eventType, {
              agentId: event.agentId,
              tool: payload.tool as string | undefined,
              model: payload.model as string | undefined,
              timestamp: event.timestamp,
              cost: payload.cost as number | undefined,
              tokens: payload.tokens as number | undefined,
              reason: payload.reason as string | undefined,
              keyId: event.keyId,
            });
          }
        }
      }
    }

    // ── Broadcast budget alerts (B1) ──────────
    // Emitted after the ingestion loop so the dashboard receives
    // a single coherent alert per threshold crossing, tagged with
    // the triggering event's timestamp.
    for (const alert of budgetAlerts) {
      broadcastEvent(userId, "budget_alert", {
        agentId: alert.agentId,
        level: alert.level,
        threshold: alert.threshold,
        prevSpent: alert.prevSpent,
        newSpent: alert.newSpent,
        budget: alert.budget,
        ratio: alert.ratio,
        triggeredAt: alert.triggeredAt,
      });
    }

    return NextResponse.json(
      { ingested },
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

    console.error("[telemetry/batch] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}