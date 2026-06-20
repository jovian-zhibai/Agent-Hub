// ──────────────────────────────────────────────
// Agent Hub SDK — DataReporter
// 批量上报遥测数据到后端，含失败重试与离线缓存
// ──────────────────────────────────────────────

import { LocalCache } from "./local-cache";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface TelemetryEvent {
  type:
    | "tool_call"
    | "token_usage"
    | "permission_denied"
    | "key_health"
    | "heartbeat"
    | "key_failover"
    | "agent_enabled"
    | "agent_disabled";
  agentId: string;
  keyId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

export interface DataReporterConfig {
  /** Backend API base URL, e.g. "https://api.agent-hub.io" */
  apiBaseUrl: string;
  /** Bearer token for authentication */
  authToken: string;
  /** Agent-specific token for telemetry reporting (preferred over authToken) */
  agentToken?: string;
  /** This agent's unique identifier */
  agentId: string;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const BATCH_INTERVAL_MS = 30_000; // 30 seconds
const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds
const RETRY_DELAYS_MS = [1_000, 3_000, 9_000];
const MAX_RETRIES = 3;
const OFFLINE_CACHE_KEY = "telemetry-offline";
const MAX_OFFLINE_EVENTS = 5_000;

// ──────────────────────────────────────────────
// DataReporter
// ──────────────────────────────────────────────

export class DataReporter {
  private config: DataReporterConfig;
  private buffer: TelemetryEvent[] = [];
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private cache: LocalCache;

  constructor(config: DataReporterConfig) {
    this.config = config;
    this.cache = new LocalCache();
  }

  // ── Public API ───────────────────────────────

  /**
   * Queue a telemetry event for batch reporting.
   * If the reporter is not running, events are still buffered.
   * If the buffer exceeds capacity, old events are dropped.
   */
  async reportEvent(event: TelemetryEvent): Promise<void> {
    if (this.buffer.length >= MAX_OFFLINE_EVENTS) {
      // Drop the oldest event to stay within limits
      this.buffer.shift();
    }

    this.buffer.push(event);

    // If not running, try to flush immediately (one-shot mode)
    if (!this.running) {
      await this.reportBatch();
    }
  }

  /**
   * Flush all buffered events to the backend.
   * Public so it can be called manually or by tests.
   */
  async reportBatch(): Promise<void> {
    if (this.buffer.length === 0) {
      return;
    }

    const batch = this.buffer.splice(0, this.buffer.length);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.sendBatch(batch);
        return; // Success — done
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < MAX_RETRIES) {
          // Exponential backoff: 1s, 3s, 9s
          const delayMs = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
          await this.sleep(delayMs);
        }
      }
    }

    // All retries exhausted — stash to offline cache
    if (lastError) {
      await this.cacheToOffline(batch);
    }
  }

  /**
   * Start the batch timer and heartbeat.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Replay any offline-cached events first
    await this.replayOfflineCache();

    // Batch timer: flush every 30s
    this.batchTimer = setInterval(() => {
      this.reportBatch().catch(() => {});
    }, BATCH_INTERVAL_MS);

    // Heartbeat: report liveness every 30s
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);

    // Send an initial heartbeat immediately
    await this.sendHeartbeat();
  }

  /**
   * Stop the batch timer and heartbeat.
   * Does NOT flush pending events — call flush() first if needed.
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.batchTimer !== null) {
      clearInterval(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Force-send all buffered events. Waits for the send to complete.
   */
  async flush(): Promise<void> {
    await this.reportBatch();

    // Also flush any remaining offline-cached events
    await this.replayOfflineCache();
  }

  // ── Internal: Network ────────────────────────

  /**
   * Get the bearer token for API requests.
   * Prefers agentToken when available, falls back to authToken.
   */
  private getBearerToken(): string {
    return this.config.agentToken ?? this.config.authToken;
  }

  /**
   * Send a batch of events to the backend API.
   *
   * P0 Bug 4 fix: fetch URL must be constructed by concatenating
   * apiBaseUrl with the endpoint path, never a relative path.
   */
  private async sendBatch(batch: TelemetryEvent[]): Promise<void> {
    const url = `${this.config.apiBaseUrl}/api/v1/telemetry/batch`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.getBearerToken()}`,
        "User-Agent": "agent-hub-sdk/1.0",
      },
      body: JSON.stringify({
        events: batch,
        agentId: this.config.agentId,
        sentAt: Date.now(),
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Telemetry batch upload failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
      );
    }
  }

  /**
   * Send a heartbeat event.
   */
  private async sendHeartbeat(): Promise<void> {
    const event: TelemetryEvent = {
      type: "heartbeat",
      agentId: this.config.agentId,
      payload: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage().heapUsed,
        bufferedEvents: this.buffer.length,
      },
      timestamp: Date.now(),
    };

    // Heartbeats are sent immediately, not batched
    try {
      const url = `${this.config.apiBaseUrl}/api/v1/telemetry/heartbeat`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.getBearerToken()}`,
          "User-Agent": "agent-hub-sdk/1.0",
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        // Non-critical — log and move on
        console.warn(`[DataReporter] Heartbeat failed: ${response.status}`);
      }
    } catch (err) {
      console.warn(`[DataReporter] Heartbeat error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Internal: Offline Cache ──────────────────

  /**
   * Store events to the offline cache when the backend is unreachable.
   */
  private async cacheToOffline(batch: TelemetryEvent[]): Promise<void> {
    try {
      const existing = await this.cache.get<TelemetryEvent[]>(OFFLINE_CACHE_KEY);
      const allEvents = [...(existing ?? []), ...batch];

      // Enforce max offline events
      if (allEvents.length > MAX_OFFLINE_EVENTS) {
        allEvents.splice(0, allEvents.length - MAX_OFFLINE_EVENTS);
      }

      await this.cache.set(OFFLINE_CACHE_KEY, allEvents, { version: 1 });
    } catch {
      // Offline cache failure is non-fatal — events are lost
      console.warn("[DataReporter] Failed to store events in offline cache");
    }
  }

  /**
   * Replay offline-cached events and send them to the backend.
   */
  private async replayOfflineCache(): Promise<void> {
    try {
      const cached = await this.cache.get<TelemetryEvent[]>(OFFLINE_CACHE_KEY);
      if (!cached || cached.length === 0) return;

      // Clear the offline cache immediately (at-most-once delivery)
      await this.cache.delete(OFFLINE_CACHE_KEY).catch(() => {});

      // Try to send the replayed events
      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          await this.sendBatch(cached);
          return; // Success
        } catch (err: unknown) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < MAX_RETRIES) {
            await this.sleep(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
          }
        }
      }

      // If still failing, re-cache with remaining events
      if (lastError) {
        console.warn(
          `[DataReporter] Failed to replay ${cached.length} offline events: ${lastError.message}`,
        );
        await this.cache.set(OFFLINE_CACHE_KEY, cached, { version: 1 }).catch(() => {});
      }
    } catch {
      // Ignore offline cache replay errors
    }
  }

  // ── Internal: Utilities ──────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}