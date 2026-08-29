// ──────────────────────────────────────────────
// Agent Hub SDK — DataReporter
// 批量上报遥测数据到后端，含失败重试与离线缓存
// ──────────────────────────────────────────────

import { LocalCache } from "./local-cache";
import * as fs from "node:fs";

// ──────────────────────────────────────────────
// 文件日志（绝不写 stdout/stderr，避免污染 TUI）
// 只在 AGENT_HUB_DEBUG=1 时写，异步追加，不阻塞主线程
// ──────────────────────────────────────────────
const DEBUG = process.env.AGENT_HUB_DEBUG === "1";
const LOG_FILE = "/tmp/agent-hub-sdk.log";

function fileLog(message: string, data?: unknown): void {
  if (!DEBUG) return;
  const line = `[${new Date().toISOString()}] [sdk] ${message}${data !== undefined ? " " + JSON.stringify(data).slice(0, 500) : ""}\n`;
  fs.appendFile(LOG_FILE, line, () => {}); // 异步，忽略错误
}

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

/**
 * Generate a deterministic event ID for idempotent ingestion.
 *
 * 按事件类型生成稳定 id：
 * - token_usage: agentId + sessionId + messageId（流式重复会塌缩为同一条，服务端 upsert 取最新）
 * - tool_call: agentId + toolCallId + timestamp（同一工具调用只有一条，timestamp 防同毫秒碰撞）
 * - 其他: agentId + type + timestamp
 *
 * 注意：之前的实现读 payload.tool（实际字段是 toolName，恒为 unknown），
 * 且 id 含 timestamp 导致 OpenCode 流式重复去不掉重。
 */
function generateEventId(event: TelemetryEvent): string {
  const p = event.payload || {};
  if (event.type === "token_usage") {
    return `${event.agentId}::token_usage::${p.sessionId ?? ""}::${p.messageId ?? ""}`;
  }
  if (event.type === "tool_call") {
    return `${event.agentId}::tool_call::${p.toolCallId ?? p.callID ?? p.sessionId ?? ""}::${event.timestamp}`;
  }
  return `${event.agentId}::${event.type}::${event.timestamp}`;
}

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
  private sending = false; // B7: Prevent interleaving between reportImmediately and reportBatch

  constructor(config: DataReporterConfig) {
    this.config = config;
    this.cache = new LocalCache();
  }

  /**
   * 将内部事件格式转换为服务端期望的 wire format。
   * 内部用 `type`，服务端 Zod schema 期望 `eventType`。
   */
  private toWireFormat(event: TelemetryEvent): Record<string, unknown> {
    const { type, ...rest } = event;
    return {
      ...rest,
      eventType: type,
    };
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

    // B7: Attach deterministic eventId for idempotent ingestion
    (event as any).eventId = generateEventId(event);

    this.buffer.push(event);

    // If not running, try to flush immediately (one-shot mode)
    if (!this.running) {
      await this.reportBatch();
    }
  }

  /**
   * 即时上报单条事件，不放缓冲区，不等待批量窗口。
   * 用于 Agent 调用结束等需要立即展示的场景。
   * 失败时 fallback 到缓冲区，等待批量发送兜底。
   */
  async reportImmediately(event: TelemetryEvent): Promise<void> {
    // B7: Attach deterministic eventId
    const eventWithId = { ...event, eventId: generateEventId(event) } as TelemetryEvent & { eventId: string };

    // B7: If a batch send is in progress, don't start a concurrent send
    if (this.sending) {
      this.buffer.push(eventWithId);
      return;
    }

    try {
      this.sending = true;
      const body = JSON.stringify({
        events: [this.toWireFormat({
          ...eventWithId,
          timestamp: eventWithId.timestamp || Date.now(),
        } as TelemetryEvent)],
      });

      const response = await fetch(`${this.config.apiBaseUrl}/api/v1/telemetry/batch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.getBearerToken()}`,
          "Connection": "close", // 禁用 keep-alive，防止 HTTP 连接阻止进程退出
        },
        body,
        signal: AbortSignal.timeout(5000), // 5s 上限，避免请求挂死拖住退出
      });

      if (!response.ok) {
        // Fallback：立即上报失败，丢进缓冲区等批量发
        this.buffer.push(eventWithId);
        fileLog("Immediate report failed, queued for batch", { status: response.status });
      }
    } catch (err) {
      // 网络错误也丢进缓冲区
      this.buffer.push(eventWithId);
      fileLog("Immediate report error, queued for batch", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.sending = false;
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

    // B7: Prevent concurrent sends
    if (this.sending) {
      return;
    }

    this.sending = true;
    try {
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
    } finally {
      this.sending = false;
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
    // unref: 让定时器不阻止 Node.js 进程退出（否则 OpenCode/Pi 退不出去）
    this.batchTimer.unref?.();

    // Heartbeat: report liveness every 30s
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat().catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    this.heartbeatTimer.unref?.();

    // Send an initial heartbeat immediately (fire-and-forget，不阻塞启动)
    void this.sendHeartbeat().catch(() => {});
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

    // 释放 HTTP 连接池（undici 的 keep-alive socket 会阻止进程退出）
    try {
      const { getGlobalDispatcher } = await import("undici");
      await getGlobalDispatcher().close();
      fileLog("HTTP dispatcher closed");
    } catch {
      // undici 不可用则忽略（Node.js 内置 fetch 可能没有独立的 undici 模块）
      fileLog("undici not available, skipping dispatcher close");
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
        "Connection": "close", // 禁用 keep-alive，防止 HTTP 连接阻止进程退出
      },
      body: JSON.stringify({
        events: batch.map((e) => this.toWireFormat(e)),
        agentId: this.config.agentId,
        sentAt: Date.now(),
      }),
      signal: AbortSignal.timeout(5000), // 5s 上限，避免请求挂死拖住退出
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Telemetry batch upload failed: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}`,
      );
    }
  }

  /**
   * Send a heartbeat event via the batch telemetry endpoint.
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

    try {
      const url = `${this.config.apiBaseUrl}/api/v1/telemetry/batch`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.getBearerToken()}`,
          "User-Agent": "agent-hub-sdk/1.0",
          "Connection": "close", // 禁用 keep-alive，防止 HTTP 连接阻止进程退出
        },
        body: JSON.stringify({
          events: [this.toWireFormat(event)],
          agentId: this.config.agentId,
          sentAt: Date.now(),
        }),
        signal: AbortSignal.timeout(5000), // 5s 上限，避免请求挂死拖住退出
      });

      if (!response.ok) {
        // Non-critical — log and move on
        fileLog("Heartbeat failed", { status: response.status });
      }
    } catch (err) {
      fileLog("Heartbeat error", { error: err instanceof Error ? err.message : String(err) });
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
      fileLog("Failed to store events in offline cache");
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
        fileLog("Failed to replay offline events", { count: cached.length, error: lastError.message });
        await this.cache.set(OFFLINE_CACHE_KEY, cached, { version: 1 }).catch(() => {});
      }
    } catch {
      // Ignore offline cache replay errors
    }
  }

  // ── Internal: Utilities ──────────────────────

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      timer.unref?.(); // 不让重试延迟的 setTimeout 阻止进程退出
    });
  }
}