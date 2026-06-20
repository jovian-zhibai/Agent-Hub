import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface CostBreakdownItem {
  model: string;
  displayName: string;
  cost: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  percentage: number;
}

interface CostBreakdownResponse {
  breakdown: CostBreakdownItem[];
  total: number;
}

interface TokenUsagePayload {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function computeStartDate(range: string | null): Date {
  const days = range === "30d" ? 30 : 7;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ──────────────────────────────────────────────
// GET /api/v1/agents/:id/cost-breakdown?range=7d|30d
// 返回按模型的花费明细
// ──────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id: agentId } = await params;

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

    // ── Parse query params ────────────────────
    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range");
    const startDate = computeStartDate(range);

    // ── Fetch token_usage events ──────────────
    const usageEvents = await prisma.telemetryLog.findMany({
      where: {
        agentId,
        eventType: "token_usage",
        reportedAt: { gte: startDate },
      },
      select: { payload: true },
    });

    if (usageEvents.length === 0) {
      return NextResponse.json(
        { breakdown: [], total: 0 } satisfies CostBreakdownResponse,
        { status: 200 }
      );
    }

    // ── Load models pricing lookup ────────────
    const allModels = await prisma.model.findMany({
      where: { isActive: true },
      select: {
        modelName: true,
        displayName: true,
        pricingInput: true,
        pricingOutput: true,
      },
    });
    const pricingMap = new Map<string, { displayName: string; pricingInput: number; pricingOutput: number }>();
    for (const m of allModels) {
      if (!pricingMap.has(m.modelName)) {
        pricingMap.set(m.modelName, {
          displayName: m.displayName,
          pricingInput: Number(m.pricingInput),
          pricingOutput: Number(m.pricingOutput),
        });
      }
    }

    // ── Aggregate by model ────────────────────
    const modelMap = new Map<
      string,
      { cost: number; calls: number; tokensIn: number; tokensOut: number }
    >();

    for (const event of usageEvents) {
      const payload = event.payload as TokenUsagePayload;
      const model = payload.model ?? "unknown";
      const tokensIn = payload.promptTokens ?? 0;
      const tokensOut = payload.completionTokens ?? 0;

      const pricing = pricingMap.get(model);
      let cost = 0;
      if (pricing) {
        cost = (tokensIn * pricing.pricingInput + tokensOut * pricing.pricingOutput) / 1_000_000;
      }

      const existing = modelMap.get(model) ?? { cost: 0, calls: 0, tokensIn: 0, tokensOut: 0 };
      modelMap.set(model, {
        cost: existing.cost + cost,
        calls: existing.calls + 1,
        tokensIn: existing.tokensIn + tokensIn,
        tokensOut: existing.tokensOut + tokensOut,
      });
    }

    // ── Compute totals ────────────────────────
    let totalCost = 0;
    const rawItems: Array<{ model: string; cost: number; calls: number; tokensIn: number; tokensOut: number }> = [];

    for (const [model, data] of modelMap) {
      totalCost += data.cost;
      rawItems.push({ model, ...data });
    }

    // ── Build sorted breakdown (cost desc) ────
    rawItems.sort((a, b) => b.cost - a.cost);

    const breakdown: CostBreakdownItem[] = rawItems.map((item) => {
      const pricing = pricingMap.get(item.model);
      const percentage = totalCost > 0 ? (item.cost / totalCost) * 100 : 0;

      return {
        model: item.model,
        displayName: pricing?.displayName ?? item.model,
        cost: Math.round(item.cost * 1000000) / 1000000,
        calls: item.calls,
        tokensIn: item.tokensIn,
        tokensOut: item.tokensOut,
        percentage: Math.round(percentage * 100) / 100,
      };
    });

    return NextResponse.json(
      {
        breakdown,
        total: Math.round(totalCost * 1000000) / 1000000,
      } satisfies CostBreakdownResponse,
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[agents/id/cost-breakdown] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}
