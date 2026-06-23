// ──────────────────────────────────────────────
// Agent Hub — Budget Enforcement Engine
//
// Centralizes the monthly-budget check so every spend
// surface (currently only telemetry ingest, future:
// manual adjustments, refunds) applies the same rules.
//
// Fixes B1: previously `monthlySpent` was incremented
// on every token_usage event but never compared against
// `monthlyBudget`. The "monthly budget" feature was a
// shell — users could set a budget and blow past it
// silently. Now:
//
//   - 80% threshold  → audit log + SSE warning
//   - 100% threshold → audit log + SSE alert + auto-disable
//
// Both checks are idempotent: they only fire on threshold
// *crossing* (prevRatio < threshold && newRatio >= threshold)
// or, for the 100% case, only when the agent is still enabled.
// Replayed events are already filtered upstream by the
// idempotent eventId check in telemetry/batch/route.ts.
// ──────────────────────────────────────────────

import type { Prisma } from "../../generated/prisma/client";

// Prisma transaction client — the subset of PrismaClient available
// inside `prisma.$transaction(async (tx) => ...)`. Using this type
// (instead of full PrismaClient) lets enforceAgentBudget be called
// from within a transaction without a type error.
type Tx = Prisma.TransactionClient;

export interface BudgetEnforcementResult {
  /** True if this event crossed the 80% warning threshold. */
  warned80: boolean;
  /** True if this event crossed the 100% threshold and the agent was auto-disabled. */
  disabled: boolean;
  /** The budget ratio after this event (0..N). Null if no budget set. */
  ratio: number | null;
}

export interface BudgetAlert {
  agentId: string;
  accountId: string;
  level: "warning" | "critical";
  threshold: 80 | 100;
  prevSpent: number;
  newSpent: number;
  budget: number;
  ratio: number;
  /** ISO timestamp of the triggering event. */
  triggeredAt: string;
}

// ──────────────────────────────────────────────
// Thresholds (configurable per-call in case future
// per-agent threshold overrides are added)
// ──────────────────────────────────────────────

export const BUDGET_WARNING_THRESHOLD = 0.8; // 80%
export const BUDGET_DISABLE_THRESHOLD = 1.0; // 100%

// ──────────────────────────────────────────────
// enforceAgentBudget
// ──────────────────────────────────────────────

/**
 * Compare the agent's new monthlySpent against its monthlyBudget
 * and take action if thresholds are crossed.
 *
 * MUST be called inside the same transaction that incremented
 * `monthlySpent`, so the audit log + agent disable roll back
 * together if anything downstream fails.
 *
 * @param tx         Active Prisma transaction client
 * @param params     See type below
 * @returns          What actions were taken (for SSE broadcast
 *                   outside the transaction)
 */
export async function enforceAgentBudget(
  tx: Tx,
  params: {
    agentId: string;
    accountId: string;
    /** monthlySpent BEFORE this event's cost was added. */
    prevSpent: number;
    /** Cost of this single event. */
    eventCost: number;
    /** Agent.monthlyBudget as number, or null if no budget set. */
    monthlyBudget: number | null;
    /** Agent.enabled BEFORE this event (to skip re-disable). */
    wasEnabled: boolean;
    /** ISO timestamp of the triggering telemetry event. */
    triggeredAt: string;
  },
): Promise<BudgetEnforcementResult> {
  const {
    agentId,
    accountId,
    prevSpent,
    eventCost,
    monthlyBudget,
    wasEnabled,
    triggeredAt,
  } = params;

  // No budget set → nothing to enforce.
  if (monthlyBudget === null || monthlyBudget <= 0) {
    return { warned80: false, disabled: false, ratio: null };
  }

  const newSpent = prevSpent + eventCost;
  const prevRatio = prevSpent / monthlyBudget;
  const newRatio = newSpent / monthlyBudget;

  let warned80 = false;
  let disabled = false;

  // ── 80% warning ────────────────────────────
  // Only fire on threshold *crossing* — if prevSpent was already
  // above 80%, we already warned for a previous event.
  if (
    prevRatio < BUDGET_WARNING_THRESHOLD &&
    newRatio >= BUDGET_WARNING_THRESHOLD
  ) {
    await tx.auditLog.create({
      data: {
        accountId,
        operatorId: null, // null = system
        action: "budget_warning_80",
        targetType: "agent",
        targetId: agentId,
        details: {
          prevSpent,
          newSpent,
          budget: monthlyBudget,
          ratio: newRatio,
          threshold: BUDGET_WARNING_THRESHOLD,
          triggeredAt,
        } as any,
      },
    });
    warned80 = true;
  }

  // ── 100% auto-disable ──────────────────────
  // Only fire when crossing 100% AND the agent is still enabled
  // (so we don't re-disable on every subsequent event after the
  // budget is exhausted — the agent is already off).
  if (newRatio >= BUDGET_DISABLE_THRESHOLD && wasEnabled) {
    await tx.agent.update({
      where: { id: agentId },
      data: {
        enabled: false,
        status: "disabled",
        disabledReason: "budget_exceeded",
      },
    });

    await tx.auditLog.create({
      data: {
        accountId,
        operatorId: null,
        action: "budget_exceeded_auto_disable",
        targetType: "agent",
        targetId: agentId,
        details: {
          prevSpent,
          newSpent,
          budget: monthlyBudget,
          ratio: newRatio,
          threshold: BUDGET_DISABLE_THRESHOLD,
          triggeredAt,
        } as any,
      },
    });
    disabled = true;
  }

  return { warned80, disabled, ratio: newRatio };
}

// ──────────────────────────────────────────────
// buildBudgetAlert
// ──────────────────────────────────────────────

/**
 * Convert an enforcement result into an SSE-ready alert payload.
 * Returns null if no alert was triggered.
 */
export function buildBudgetAlert(
  params: {
    agentId: string;
    accountId: string;
    prevSpent: number;
    newSpent: number;
    budget: number;
    triggeredAt: string;
  },
  result: BudgetEnforcementResult,
): BudgetAlert | null {
  if (result.disabled) {
    return {
      agentId: params.agentId,
      accountId: params.accountId,
      level: "critical",
      threshold: 100,
      prevSpent: params.prevSpent,
      newSpent: params.newSpent,
      budget: params.budget,
      ratio: result.ratio ?? 1,
      triggeredAt: params.triggeredAt,
    };
  }
  if (result.warned80) {
    return {
      agentId: params.agentId,
      accountId: params.accountId,
      level: "warning",
      threshold: 80,
      prevSpent: params.prevSpent,
      newSpent: params.newSpent,
      budget: params.budget,
      ratio: result.ratio ?? 0.8,
      triggeredAt: params.triggeredAt,
    };
  }
  return null;
}
