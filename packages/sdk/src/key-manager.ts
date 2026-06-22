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
   */
  async getActiveKey(): Promise<KeyBinding | null> {
    await this.ensureLoaded();

    if (this.disabled || this.bindings.length === 0) {
      return null;
    }

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
   */
  async handleFailure(failedKeyId: string): Promise<KeyBinding | null> {
    await this.ensureLoaded();

    const failedBinding = this.bindings.find((b) => b.keyId === failedKeyId);
    if (!failedBinding) {
      return null;
    }

    // Determine the reason based on current status
    const reason = failedBinding.status === "depleted"
      ? "depleted"
      : "rate_limited";

    // Mark as failed
    failedBinding.status = "failed";
    this.currentIndex = -1;

    await this.reportEvent({
      type: "key_failover",
      keyId: failedKeyId,
      payload: { reason, fromKeyId: failedKeyId },
    });

    // Try to promote the next standby key
    const promoted = await this.promoteStandby();

    // Persist changes
    await this.persistBindings();

    return promoted; // null = no failover available (termination condition met)
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
