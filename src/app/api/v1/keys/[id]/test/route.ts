import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import { testProviderKey } from "@/lib/provider-tester";

// ──────────────────────────────────────────────
// POST /api/v1/keys/:id/test
// Test API key connectivity with the actual provider
// ──────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getAuthUser(request);
    const { id } = await params;

    // ── Fetch key with provider info ────────────
    const key = await prisma.key.findUnique({
      where: { id },
      include: {
        provider: {
          select: {
            name: true,
            baseUrls: true,
          },
        },
      },
    });

    if (!key) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Key not found" },
        { status: 404 }
      );
    }

    if (key.accountId !== user.id) {
      return NextResponse.json(
        { code: "FORBIDDEN", message: "Access denied" },
        { status: 403 }
      );
    }

    // ── Test the key with provider API ─────────
    const baseUrl = typeof key.provider.baseUrls === "object" && key.provider.baseUrls !== null
      ? (key.provider.baseUrls as Record<string, string>)[key.protocol]
      : undefined;

    const testResult = await testProviderKey(
      key.keyEncrypted,
      key.provider.name,
      key.protocol,
      baseUrl
    );

    // ── Update key health status ───────────────
    const now = new Date();
    await prisma.key.update({
      where: { id },
      data: {
        health: testResult.health,
        lastTestedAt: now,
      },
    });

    return NextResponse.json(
      {
        success: testResult.success,
        status: testResult.success ? "connected" : "failed",
        health: testResult.health,
        message: testResult.message,
        details: testResult.details,
        testedAt: now.toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[keys/id/test] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}