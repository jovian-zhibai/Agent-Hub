import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, ApiError } from "@/lib/auth";
import { encryptKey, extractKeyPrefix } from "@/lib/crypto";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface KeyResponse {
  id: string;
  keyLabel: string;
  provider: { id: string; name: string; displayName: string };
  protocol: string;
  keyPrefix: string | null;
  scope: string;
  group: string | null;
  note: string | null;
  health: string;
  initialBalance: number | null;
  burnRate: number | null;
  lastTestedAt: string | null;
  isActive: boolean;
  agentCount: number;
  createdAt: string;
}

// ──────────────────────────────────────────────
// GET /api/v1/keys
// List all keys for the current user
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getAuthUser(request);

    // ── Parse query filters ──────────────────
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get("providerId");
    const health = searchParams.get("health");
    const scope = searchParams.get("scope");

    // ── Build where clause ────────────────────
    const where: Record<string, unknown> = { accountId: user.id };
    if (providerId) where.providerId = providerId;
    if (health) where.health = health;
    if (scope) where.scope = scope;

    // ── Fetch keys ────────────────────────────
    const keys = await prisma.key.findMany({
      where: where as any,
      include: {
        provider: { select: { id: true, name: true, displayName: true } },
        keyBindings: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // ── Build response (mask sensitive fields)─
    const result: KeyResponse[] = keys.map((key) => ({
      id: key.id,
      keyLabel: key.keyLabel,
      provider: {
        id: key.provider.id,
        name: key.provider.name,
        displayName: key.provider.displayName,
      },
      protocol: key.protocol,
      keyPrefix: key.keyPrefix,
      scope: key.scope,
      group: key.group ?? null,
      note: key.note ?? null,
      health: key.health,
      initialBalance: key.initialBalance ? Number(key.initialBalance) : null,
      burnRate: key.burnRate ? Number(key.burnRate) : null,
      lastTestedAt: key.lastTestedAt?.toISOString() ?? null,
      isActive: key.isActive,
      agentCount: key.keyBindings.length,
      createdAt: key.createdAt.toISOString(),
    }));

    return NextResponse.json({ keys: result, total: result.length, lastUpdated: new Date().toISOString() }, { status: 200 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[keys] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────
// POST /api/v1/keys
// Create a new API key
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const user = await getAuthUser(request);

    const body = await request.json();
    // ── Field aliasing for frontend compatibility ──
    // Frontend sends `provider` (name) instead of `providerId`; `keyValue` instead of `keyEncrypted`; `label` instead of `keyLabel`
    const providerId = body.providerId || body.provider;
    const keyEncrypted = body.keyEncrypted || body.keyValue;
    const keyLabel = body.keyLabel || body.label;

    const {
      protocol,
      scope,
      group,
      note,
      initialBalance,
    } = body as {
      protocol?: string;
      scope?: string;
      group?: string;
      note?: string;
      initialBalance?: number;
    };

    // ── Validate required fields ────────────
    if (!providerId || !protocol || !keyLabel || !keyEncrypted) {
      return NextResponse.json(
        { code: "VALIDATION_ERROR", message: "providerId (or provider), protocol, keyLabel (or label), and keyEncrypted (or keyValue) are required" },
        { status: 400 }
      );
    }

    // ── Verify provider exists ──────────────
    // `providerId` may be a UUID or a provider name — try both
    let provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { id: true },
    });

    if (!provider) {
      provider = await prisma.provider.findFirst({
        where: { name: { equals: providerId, mode: "insensitive" } },
        select: { id: true },
      });
    }

    if (!provider) {
      return NextResponse.json(
        { code: "NOT_FOUND", message: "Provider not found" },
        { status: 404 }
      );
    }

    // ── Encrypt key with AES-256-GCM ─────────
    const encryptedValue = encryptKey(keyEncrypted);
    const keyPrefix = extractKeyPrefix(keyEncrypted);

    // ── Check for duplicate key label ─────────
    const existing = await prisma.key.findFirst({
      where: { accountId: user.id, keyLabel },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { code: "DUPLICATE", message: "Key already exists" },
        { status: 409 },
      );
    }

    // ── Create key ──────────────────────────
    const key = await prisma.key.create({
      data: {
        accountId: user.id,
        providerId: provider.id,
        protocol,
        keyLabel,
        keyEncrypted: encryptedValue,
        keyPrefix,
        scope: (scope ?? "personal") as any,
        group: group ?? null,
        note: note ?? null,
        initialBalance: initialBalance ?? null,
        isActive: true,
      },
      include: {
        provider: { select: { id: true, name: true, displayName: true } },
        keyBindings: { select: { id: true } },
      },
    });

    const response: KeyResponse = {
      id: key.id,
      keyLabel: key.keyLabel,
      provider: {
        id: key.provider.id,
        name: key.provider.name,
        displayName: key.provider.displayName,
      },
      protocol: key.protocol,
      keyPrefix: key.keyPrefix,
      scope: key.scope,
      group: key.group ?? null,
      note: key.note ?? null,
      health: key.health,
      initialBalance: key.initialBalance ? Number(key.initialBalance) : null,
      burnRate: key.burnRate ? Number(key.burnRate) : null,
      lastTestedAt: key.lastTestedAt?.toISOString() ?? null,
      isActive: key.isActive,
      agentCount: key.keyBindings.length,
      createdAt: key.createdAt.toISOString(),
    };

    return NextResponse.json({ key: response }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { code: error.name === "AuthError" ? "AUTH_ERROR" : "API_ERROR", message: error.message },
        { status: error.statusCode }
      );
    }

    console.error("[keys] Unexpected error:", error);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message: "Internal server error" },
      { status: 500 }
    );
  }
}