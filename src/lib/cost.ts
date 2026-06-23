// ──────────────────────────────────────────────
// Agent Hub — Cost Calculation Helpers
//
// Centralizes token-field extraction and per-event cost
// math so every cost surface (dashboard, agent detail,
// cost-trend, cost-breakdown, key usage) computes the
// same number from the same payload shape.
//
// Fixes:
//   - B9: cost-breakdown / keys/[id]/usage read the wrong
//     token fields and silently returned $0. Now all routes
//     accept BOTH naming conventions (tokensIn/tokensOut
//     preferred, promptTokens/completionTokens as legacy).
//   - B14: money math now happens in integer micro-USD
//     (1e-6 USD) before scaling back, minimizing IEEE-754
//     drift on large token counts.
// ──────────────────────────────────────────────

import type { PrismaClient } from "../../generated/prisma/client";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

/**
 * Loosely-typed view of a token_usage telemetry payload.
 * Both naming conventions are accepted because the SDK and
 * the historical routes disagree on field names.
 */
export interface TokenUsagePayload {
  model?: string;
  // New convention (preferred)
  tokensIn?: number;
  tokensOut?: number;
  totalTokens?: number;
  // Legacy convention (fallback)
  promptTokens?: number;
  completionTokens?: number;
}

export interface PricingEntry {
  /** Display name, optional (only some routes need it). */
  displayName?: string;
  /** USD per 1M input tokens. */
  pricingInput: number;
  /** USD per 1M output tokens. */
  pricingOutput: number;
}

export type PricingMap = Map<string, PricingEntry>;

export interface ExtractedTokens {
  tokensIn: number;
  tokensOut: number;
  model: string;
}

// ──────────────────────────────────────────────
// Pricing map
// ──────────────────────────────────────────────

/**
 * Load the active model pricing table into a lookup map.
 *
 * Behavior matches the (previously duplicated) block in 5
 * routes: first occurrence of a modelName wins, prices are
 * USD-per-1M-tokens.
 *
 * @param includeDisplayName set true when the caller renders
 *   model names (dashboard, cost-breakdown).
 */
export async function loadPricingMap(
  prisma: PrismaClient,
  options?: { includeDisplayName?: boolean },
): Promise<PricingMap> {
  const allModels = await prisma.model.findMany({
    where: { isActive: true },
    select: {
      modelName: true,
      displayName: options?.includeDisplayName ?? false,
      pricingInput: true,
      pricingOutput: true,
    },
  });

  const pricingMap: PricingMap = new Map();
  for (const m of allModels) {
    if (pricingMap.has(m.modelName)) continue;
    pricingMap.set(m.modelName, {
      ...(options?.includeDisplayName ? { displayName: m.displayName } : {}),
      pricingInput: Number(m.pricingInput),
      pricingOutput: Number(m.pricingOutput),
    });
  }
  return pricingMap;
}

// ──────────────────────────────────────────────
// Token extraction
// ──────────────────────────────────────────────

/**
 * Extract normalized token counts from a telemetry payload.
 *
 * Accepts both `tokensIn`/`tokensOut` (new) and
 * `promptTokens`/`completionTokens` (legacy), preferring the
 * new names. This is the single source of truth — fixes B9
 * where two routes only read the legacy fields.
 */
export function extractTokens(
  payload: Record<string, unknown> | TokenUsagePayload | null | undefined,
): ExtractedTokens {
  const p = (payload ?? {}) as TokenUsagePayload;

  // Non-number values (e.g. stringified) fall back to 0 via Number()
  const tokensIn =
    typeof p.tokensIn === "number"
      ? p.tokensIn
      : typeof p.promptTokens === "number"
        ? p.promptTokens
        : Number(p.tokensIn ?? p.promptTokens ?? 0) || 0;

  const tokensOut =
    typeof p.tokensOut === "number"
      ? p.tokensOut
      : typeof p.completionTokens === "number"
        ? p.completionTokens
        : Number(p.tokensOut ?? p.completionTokens ?? 0) || 0;

  const model =
    typeof p.model === "string" && p.model.length > 0 ? p.model : "unknown";

  // S10: Prevent negative token values (negative-cost attack)
  const safeTokensIn = Math.max(0, tokensIn);
  const safeTokensOut = Math.max(0, tokensOut);

  return { tokensIn: safeTokensIn, tokensOut: safeTokensOut, model };
}

// ──────────────────────────────────────────────
// Cost math (integer micro-USD to avoid float drift)
// ──────────────────────────────────────────────

/**
 * Compute the USD cost of a single telemetry event.
 *
 * Pricing is USD-per-1M-tokens. To minimize IEEE-754 error we
 * compute in micro-USD (1e-6 USD) as integers, then scale back.
 *
 * Returns 0 when the model is unknown to the pricing map.
 *
 * Fix for B14: previously each route did
 *   `(tokensIn * pricingInput + tokensOut * pricingOutput) / 1_000_000`
 * in plain JS Number, which drifts on large counts.
 */
export function computeEventCost(
  payload: Record<string, unknown> | TokenUsagePayload | null | undefined,
  pricingMap: PricingMap,
): { cost: number; tokensIn: number; tokensOut: number; model: string } {
  const { tokensIn, tokensOut, model } = extractTokens(payload);

  const pricing = pricingMap.get(model);
  if (!pricing) {
    return { cost: 0, tokensIn, tokensOut, model };
  }

  // Pricing is stored as USD per 1M tokens. A price of P USD/1M
  // equals P micro-USD per single token (since 1M tokens = 1 USD·P
  // => 1 token = P / 1M USD = P micro-USD). So:
  //
  //   costMicroUsd = tokensIn * pricingInput + tokensOut * pricingOutput
  //   costUsd      = costMicroUsd / 1_000_000
  //
  // Working in micro-USD keeps the magnitude small and the only
  // fractional step is a single final division, minimizing IEEE-754
  // drift vs. the old `(t * p + t * p) / 1_000_000` done in plain
  // Number (which drifted on large accumulated counts).
  const MICRO_USD_PER_USD = 1_000_000;

  const costMicroUsd =
    tokensIn * pricing.pricingInput + tokensOut * pricing.pricingOutput;

  // Single fractional step: micro-USD → USD. Round to 6 decimals
  // (sub-cent precision is irrelevant and clamps residual float error).
  const costUsd = Math.round(costMicroUsd) / MICRO_USD_PER_USD;

  return { cost: costUsd, tokensIn, tokensOut, model };
}
