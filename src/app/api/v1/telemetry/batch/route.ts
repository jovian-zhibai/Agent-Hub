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
    // ── Dual-mode auth: userToken (dashboard) or agentToken (SDK) ──
    let userId: string;
    let isAgentAuth = false;

    // Try agent token first (SDK / CLI calls)
    const agentPayload = verifyAgentToken(request);
    if (agentPayload) {
      userId = agentPayload.userId;
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

    let ingested = 0;
    const budgetAlerts: BudgetAlert[] = [];
    if (validEvents.length > 0) {
      // B1/B3: load pricing once to compute per-event cost for budget tracking
      const pricingMap =
        validEvents.some((e) => e.eventType === "token_usage")
          ? await loadPricingMap(prisma)
          : new Map();

      for (const event of validEvents) {
        // B7: Use deterministic eventId for idempotent upsert
        const eventId =
          event.eventId ||
          `${event.agentId}::${event.timestamp}::${event.eventType}::${String(event.payload?.tool || "unknown")}::${String(event.payload?.model || "unknown")}`;

        // B1/B3/B4: accumulate cost + aggregates in a transaction so the
        // telemetry row, the agent/key counters, and the hourly/daily rollups
        // stay consistent even if one part fails.
        const reportedAt = new Date(event.timestamp || Date.now());
        const isTokenUsage = event.eventType === "token_usage";

        await prisma.$transaction(async (tx) => {
          // 1. Idempotent insert: check existence first so we can tell
          //    new vs. replay. (Prisma's upsert returns a row either way,
          //    so it can't signal "was this a fresh insert?".)
          const existing = await tx.telemetryLog.findUnique({
            where: { eventId },
            select: { id: true },
          });
          if (existing) return; // replay — skip all downstream accounting

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

          // B8: Record key_failover events in FailoverLog table
          if (event.eventType === "key_failover") {
            const payload = event.payload || {};
            const fromKeyId = (payload.fromKeyId || payload.from || payload.keyId || "") as string;
            const toKeyId = (payload.toKeyId || payload.to || "") as string;
            const reason = (payload.reason || "unknown") as string;

            if (fromKeyId && toKeyId) {
              await tx.failoverLog
                .create({
                  data: {
                    agentId: event.agentId,
                    fromKeyId: fromKeyId || null,
                    toKeyId: toKeyId || null,
                    reason,
                    triggeredAt: reportedAt,
                  },
                })
                .catch(() => {
                  // Non-critical: failover logging is best-effort
                });
            }
          }

          // B1/B2: update agent monthlySpent on token usage
          if (isTokenUsage) {
            const { cost, tokensIn, tokensOut } = computeEventCost(event.payload, pricingMap);

            // B1: fetch current agent state BEFORE incrementing so we can
            // detect threshold crossings (80% warning / 100% auto-disable).
            const agentBefore = await tx.agent.findUnique({
              where: { id: event.agentId },
              select: {
                monthlySpent: true,
                monthlyBudget: true,
                enabled: true,
              },
            });

            const prevSpent = agentBefore ? Number(agentBefore.monthlySpent) : 0;
            const monthlyBudget = agentBefore?.monthlyBudget
              ? Number(agentBefore.monthlyBudget)
              : null;
            const wasEnabled = agentBefore?.enabled ?? true;

            // B1: agent budget accumulator
            await tx.agent.update({
              where: { id: event.agentId },
              data: { monthlySpent: { increment: cost } },
            });

            // B1: budget enforcement — 80% warning + 100% auto-disable.
            // Runs inside the same transaction so the audit log + agent
            // disable roll back together if anything downstream fails.
            if (agentBefore && monthlyBudget !== null && monthlyBudget > 0) {
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
                  newSpent: prevSpent + cost,
                  budget: monthlyBudget,
                  triggeredAt: reportedAt.toISOString(),
                },
                budgetResult,
              );
              if (alert) budgetAlerts.push(alert);
            }

            // B3: key spend tracking — increment spent; decrement currentBalance
            // only if the key tracks a balance (null = unlimited / prepaid elsewhere).
            if (event.keyId) {
              try {
                const key = await tx.key.findUnique({
                  where: { id: event.keyId },
                  select: { currentBalance: true },
                });
                if (key) {
                  await tx.key.update({
                    where: { id: event.keyId },
                    data: {
                      spent: { increment: cost },
                      ...(key.currentBalance !== null
                        ? { currentBalance: { decrement: cost } }
                        : {}),
                    },
                  });
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
        });

        ingested++;
      }

      // ── Broadcast each event to SSE subscribers ──
      for (const event of validEvents) {
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