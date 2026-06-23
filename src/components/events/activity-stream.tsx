"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/contexts/auth";
import { API_BASE } from "@/lib/api";

// ── Types ──────────────────────────────────────

interface ActivityEvent {
  id: string;
  agentId: string;
  type: string;
  tool?: string;
  model?: string;
  timestamp: number;
  cost?: number;
  tokens?: number;
  reason?: string;
}

// ── Helpers ────────────────────────────────────

const EVENT_ICONS: Record<string, string> = {
  tool_call: "🔧",
  token_usage: "🧠",
  permission_denied: "🚫",
  key_failover: "🔄",
  heartbeat: "💓",
  key_health: "🔑",
  agent_enabled: "✅",
  agent_disabled: "⏸",
};

function getIcon(type: string): string {
  return EVENT_ICONS[type] || "📡";
}

function truncate(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) : id;
}

// ── Component ──────────────────────────────────

export function ActivityStream({ maxItems = 50 }: { maxItems?: number }) {
  const { token } = useAuth();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!token) return;

    let reconnect = true;
    let currentToken = token; // fallback to access token if SSE token fetch fails

    async function connect() {
      if (!reconnect) return;

      // C4: Fetch a short-lived SSE token instead of sending the full JWT in URL
      try {
        const res = await fetch(`${API_BASE}/v1/auth/sse-token`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          currentToken = data.token;
        }
      } catch {
        // Fallback: use the access token (existing behavior)
      }

      const es = new EventSource(`${API_BASE}/v1/events?token=${currentToken}`);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
      };

      // Listen for all known event types
      const eventTypes = [
        "tool_call",
        "token_usage",
        "permission_denied",
        "key_failover",
        "heartbeat",
        "key_health",
        "agent_enabled",
        "agent_disabled",
      ];

      for (const type of eventTypes) {
        es.addEventListener(type, (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data);
            setEvents((prev) =>
              [{ ...data, id: crypto.randomUUID(), type }, ...prev].slice(0, maxItems),
            );
          } catch {
            // Ignore malformed data
          }
        });
      }

      es.onerror = () => {
        setConnected(false);
        es.close();
        eventSourceRef.current = null;

        // Reconnect after 3s
        if (reconnect) {
          reconnectTimer.current = setTimeout(connect, 3000);
        }
      };
    }

    connect();

    return () => {
      reconnect = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (eventSourceRef.current) eventSourceRef.current.close();
    };
  }, [token, maxItems]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-300">⚡ 实时活动</h3>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            connected
              ? "bg-emerald-900/50 text-emerald-400"
              : "bg-slate-800 text-slate-500"
          }`}
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              connected ? "bg-emerald-400" : "bg-slate-500"
            }`}
          />
          {connected ? "已连接" : "未连接"}
        </span>
      </div>

      {/* Event list */}
      <div className="space-y-1 max-h-[400px] overflow-y-auto">
        {events.length === 0 && (
          <p className="text-sm text-slate-500 text-center py-8">
            {connected ? "等待 Agent 活动..." : "正在连接..."}
          </p>
        )}
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-center gap-2 text-sm p-2 rounded bg-slate-800/40 hover:bg-slate-800/60 transition-colors"
          >
            {/* Timestamp */}
            <span className="text-xs text-slate-500 w-14 shrink-0 tabular-nums">
              {new Date(event.timestamp).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>

            {/* Icon */}
            <span className="w-5 text-center shrink-0 text-xs">
              {getIcon(event.type)}
            </span>

            {/* Agent ID */}
            <span className="text-slate-300 font-mono text-xs w-16 shrink-0 truncate" title={event.agentId}>
              {truncate(event.agentId)}
            </span>

            {/* Event type + detail */}
            <span className="text-slate-400 truncate min-w-0">
              {event.tool && <span className="text-indigo-400">{event.tool}</span>}
              {event.model && <span className="text-cyan-400">{event.model}</span>}
              {event.reason && <span className="text-amber-400">{event.reason}</span>}
              {!event.tool && !event.model && !event.reason && (
                <span className="text-slate-500">{event.type.replace(/_/g, " ")}</span>
              )}
            </span>

            {/* Cost / Tokens badge */}
            <span className="ml-auto shrink-0 flex items-center gap-2">
              {event.tokens !== undefined && (
                <span className="text-[11px] text-slate-500">
                  {event.tokens.toLocaleString()} tok
                </span>
              )}
              {event.cost !== undefined && (
                <span className="rounded bg-slate-700/60 px-1.5 py-0.5 text-[11px] font-medium text-amber-400/80">
                  ${event.cost.toFixed(4)}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}