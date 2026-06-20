import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";

// ──────────────────────────────────────────────
// GET /api/v1/models
// List models, optionally filtered by providerId.
// Returned grouped by provider.
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await getAuthUser(request);
    // ── Parse query filters ──────────────────
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId");

    // ── Build where clause ────────────────────
    const where: Record<string, unknown> = {};
    if (providerId) where.providerId = providerId;

    // ── Fetch models ──────────────────────────
    const models = await prisma.model.findMany({
      where: where as any,
      include: {
        provider: {
          select: { id: true, name: true },
        },
      },
      orderBy: [{ providerId: "asc" }, { displayName: "asc" }],
    });

    const result = models.map((m) => ({
      id: m.id,
      modelName: m.modelName,
      displayName: m.displayName,
      provider: { id: m.provider.id, name: m.provider.name },
      defaultProtocol: m.defaultProtocol,
      supportedProtocols: m.supportedProtocols as string[],
      pricingInput: Number(m.pricingInput),
      pricingOutput: Number(m.pricingOutput),
      pricingSource: m.pricingSource,
      pricingAsOf: m.pricingAsOf?.toISOString() ?? null,
      isActive: m.isActive,
    }));

    return NextResponse.json({ models: result, total: result.length }, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[models] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}