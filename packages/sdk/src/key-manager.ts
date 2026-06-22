// ──────────────────────────────────────────────
// Agent Hub SDK — KeyManager
// Key 优先级管理 + 自动 failover
// ──────────────────────────────────────────────

import { LocalCache } from "./local-cache";
import { DataReporter, TelemetryEvent } from "./data-reporter";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface KeyBinding {
  keyId: string;
  provider: string;
  protocol: string;
  status: "active" | "standby" | "depleted" | "failed";
  /**
   * B5: Timestamp (ms since epoch) when a rate-limited key becomes
   * usable again. Null = not rate-limited.
   *
   * When a key receives a 429, the SDK sets this to `Date.now() + retryAfterMs`
   * and temporarily marks the binding as "standby" (NOT "failed"). The key
   * stays in the pool and is automatically re-promoted once the window expires.
   */
  rateLimitedUntil?: number | null;
}

export interface KeyManagerConfig {
  keyBindings: KeyBinding[];
  version: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  supportedProtocols: string[];
  baseUrls: Record<string, string>;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const CACHE_KEY = "key-bindings";
const PROVIDER_CACHE_KEY = "providers";

/**
 * B5: Default retry-after window (60s) when the provider doesn't
 * return a Retry-After header. Most providers (OpenAI, Anthropic)
 * rate-limit for 30-60s, so 60s is a safe upper bound.
 */
const DEFAULT_RETRY_AFTER_MS = 60_000;

// ──────────────────────────────────────────────
// KeyManager
// ──────────────────────────────────────────────

export class KeyManager {
  private bindings: KeyBinding[] = [];
  private currentIndex: number = -1; // Index of the currently active key in bindings[]
  private loaded: boolean = false;
  private disabled: boolean = false;
  private version: number = 0;

  constructor(
    private cache: LocalCache,
    private reporter?: DataReporter,
    private agentId?: string, // B8: Store agentId for failover event reporting
  ) {}

  // ── Public API ───────────────────────────────

  /**
   * Get the currently active (highest-priority healthy) key.
   *
   * P0 Bug 3 fix: has explicit termination condition — if promoteStandby
   * fails to find a viable key, returns null instead of recursing infinitely.
   *
   * B5 fix: before selecting a key, recovers any keys whose rate-limit
   * window has expired, so they can be re-promoted instead of being
   * permanently stuck in "standby".
   */
  async getActiveKey(): Promise<KeyBinding | null> {
    await this.ensureLoaded();

    if (this.disabled || this.bindings.length === 0) {
      return null;
    }

    // B5: Recover any keys whose rate-limit window has expired.
    this.recoverRateLimitedKeys();

    // If we already have a current index and it's still valid, return it
    if (this.currentIndex >= 0 && this.currentIndex < this.bindings.length) {
      const current = this.bindings[this.currentIndex];
      if (current.status === "active") {
        return current;
      }
    }

    // Otherwise, find the best available key
    const active = this.findActiveBinding();
    if (active !== null) {
      this.currentIndex = this.bindings.indexOf(active);
      return active;
    }

    // No active key found — try promoting a standby
    const promoted = await this.promoteStandby();
    return promoted; // null means no viable key at all (no recursion)
  }

  /**
   * Switch to a specific key by ID.
   */
  async switchToKey(keyId: string): Promise<void> {
    await this.ensureLoaded();

    const idx = this.bindings.findIndex((b) => b.keyId === keyId);
    if (idx === -1) {
      throw new Error(`Key not found in bindings: ${keyId}`);
    }

    // Mark all other active keys as standby
    for (const b of this.bindings) {
      if (b.keyId !== keyId && b.status === "active") {
        b.status = "standby";
      }
    }

    // Mark the target as active
    this.bindings[idx].status = "active";
    this.currentIndex = idx;

    await this.reportEvent({
      type: "key_health",
      keyId,
      payload: { action: "manual_switch" },
    });

    // Persist the updated bindings
    await this.persistBindings();
  }

  /**
   * Mark a key as failed and automatically fail over to the next available key.
   * Returns the new active key, or null if no fallback exists.
   *
   * B5 fix: rate-limited keys are NO LONGER permanently marked "failed".
   * Instead they go to "standby" with a `rateLimitedUntil` timestamp and
   * are automatically recovered by `getActiveKey()` once the window expires.
   * Only "depleted" and other permanent failures are marked "failed".
   *
   * @param failedKeyId  The key that failed
   * @param opts.retryAfterMs  For 429 rate-limit: ms until the key is usable
   *                           again. If omitted, uses DEFAULT_RETRY_AFTER_MS.
   *                           Ignored for non-rate-limit failures.
   * @param opts.reason   Override the failure reason. If omitted, inferred
   *                      from current status: "depleted" → permanent, else
   *                      "rate_limited" (temporary).
   */
  async handleFailure(
    failedKeyId: string,
    opts?: { retryAfterMs?: number; reason?: "rate_limited" | "depleted" | "invalid" },
  ): Promise<KeyBinding | null> {
    await this.ensureLoaded();

    const failedBinding = this.bindings.find((b) => b.keyId === failedKeyId);
    if (!failedBinding) {
      return null;
    }

    // Determine the reason: explicit override > inferred from status
    const reason =
      opts?.reason ??
      (failedBinding.status === "depleted" ? "depleted" : "rate_limited");

    const isTemporary = reason === "rate_limited";

    if (isTemporary) {
      // B5: Rate-limited keys are temporarily parked as "standby" with
      // a recovery timestamp. They stay in the pool and are re-promoted
      // automatically once the window expires.
      const retryAfterMs = opts?.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
      failedBinding.status = "standby";
      failedBinding.rateLimitedUntil = Date.now() + retryAfterMs;
    } else {
      // Permanent failure (depleted / invalid) — mark as "failed" for real
      failedBinding.status = "failed";
      failedBinding.rateLimitedUntil = null;
    }

    this.currentIndex = -1;

    await this.reportEvent({
      type: "key_failover",
      keyId: failedKeyId,
      payload: {
        reason,
        fromKeyId: failedKeyId,
        ...(isTemporary
          ? { retryAfterMs: opts?.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS }
          : {}),
      },
    });

    // Try to promote the next standby key
    const promoted = await this.promoteStandby();

    // Persist changes
    await this.persistBindings();

    return promoted; // null = no failover available (termination condition met)
  }

  /**
   * B5: Mark a key as rate-limited without going through the full
   * `handleFailure` path. Use this when the SDK receives a 429 and
   * wants to park the key temporarily + fail over, but doesn't want
   * to emit a "depleted" or "invalid" signal.
   *
   * Equivalent to `handleFailure(keyId, { reason: "rate_limited", retryAfterMs })`.
   */
  async handleRateLimit(
    keyId: string,
    retryAfterMs?: number,
  ): Promise<KeyBinding | null> {
    return this.handleFailure(keyId, {
      reason: "rate_limited",
      retryAfterMs,
    });
  }

  /**
   * Reload key binding configuration from the local cache.
   */
  async reload(): Promise<void> {
    try {
      const config = await this.cache.get<KeyManagerConfig>(CACHE_KEY);
      if (config === null) {
        this.bindings = [];
        this.currentIndex = -1;
        this.loaded = false;
        this.disabled = false;
        return;
      }

      this.bindings = config.keyBindings;
      this.version = config.version;
      this.loaded = true;
      this.disabled = false;

      // Reset current index — find the active one
      this.currentIndex = this.bindings.findIndex((b) => b.status === "active");
    } catch {
      this.loaded = false;
      this.disabled = true;
    }
  }

  /**
   * Whether the agent is disabled (no viable keys / key config missing).
   */
  get isDisabled(): boolean {
    return this.disabled;
  }

  /**
   * Get all current bindings (read-only snapshot).
   */
  getBindings(): KeyBinding[] {
    return [...this.bindings];
  }

  // ── Internal Helpers ─────────────────────────

  /**
   * Ensure bindings are loaded from cache before any operation.
   */
  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.reload();
    }
  }

  /**
   * Find the first binding with status "active".
   */
  private findActiveBinding(): KeyBinding | null {
    return this.bindings.find((b) => b.status === "active") ?? null;
  }

  /**
   * B5: Scan all bindings and reset any keys whose rate-limit window
   * has expired back to "standby" (so they can be re-promoted).
   *
   * Called at the start of `getActiveKey()` so the SDK naturally
   * recovers rate-limited keys without needing a background timer.
   * This is a synchronous, in-memory operation — no I/O.
   *
   * If any keys were recovered, re-enables the agent (in case it
   * was disabled because all keys were temporarily rate-limited).
   */
  private recoverRateLimitedKeys(): void {
    const now = Date.now();
    let recovered = false;

    for (const b of this.bindings) {
      if (
        b.rateLimitedUntil !== null &&
        b.rateLimitedUntil !== undefined &&
        b.rateLimitedUntil <= now &&
        b.status === "standby"
      ) {
        // Rate-limit window expired — clear the timestamp.
        // Status stays "standby" so promoteStandby() can pick it up.
        b.rateLimitedUntil = null;
        recovered = true;
      }
    }

    // If we recovered any keys and the agent was disabled (because all
    // keys were temporarily rate-limited), re-enable it so getActiveKey
    // can try promoting a recovered key.
    if (recovered && this.disabled) {
      this.disabled = false;
    }
  }

  /**
   * Promote a standby key to active.
   *
   * P0 Bug 3 fix: This method does NOT recursively call getActiveKey().
   * It directly finds and promotes a standby; if none exist, returns null.
   */
  private async promoteStandby(): Promise<KeyBinding | null> {
    const standby = this.bindings.find((b) => b.status === "standby");
    if (!standby) {
      // No standby available → entire agent is disabled
      this.disabled = true;
      return null;
    }

    // Promote to active
    standby.status = "active";
    this.currentIndex = this.bindings.indexOf(standby);

    await this.reportEvent({
      type: "key_failover",
      keyId: standby.keyId,
      payload: { promotedFrom: "standby" },
    });

    return standby;
  }

  /**
   * Persist current bindings to cache.
   */
  private async persistBindings(): Promise<void> {
    const config: KeyManagerConfig = {
      keyBindings: this.bindings,
      version: this.version,
    };
    await this.cache.set(CACHE_KEY, config);
  }

  /**
   * Report a key-related event.
   *
   * P0 Bug 2 fix: type comes from the parameter, not hardcoded "heartbeat".
   * B8 fix: pass real agentId instead of empty string.
   */
  private async reportEvent(params: {
    type: TelemetryEvent["type"];
    keyId: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    if (!this.reporter) return;

    try {
      await this.reporter.reportEvent({
        type: params.type,
        agentId: this.agentId || "",
        keyId: params.keyId,
        payload: params.payload,
        timestamp: Date.now(),
      });
    } catch {
      // Report failure is non-fatal for key operations
    }
  }
}
