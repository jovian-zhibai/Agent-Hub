"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAgent, useCostTrend, useCostBreakdown } from "@/lib/hooks";
import { agents, type PermissionEntry, type FailoverLog } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber, cn } from "@/lib/utils";
import CostTrend from "@/components/dashboard/cost-trend";
import {
  ArrowLeft,
  Loader2,
  Bot,
  PhoneCall,
  DollarSign,
  Activity,
  CheckCircle2,
  Shield,
} from "lucide-react";
// ── Tab types ──────────────────────────────────

type Tab = "overview" | "costs" | "permissions" | "failover";

const TABS: { key: Tab; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "costs", label: "Cost Details" },
  { key: "permissions", label: "Permissions" },
  { key: "failover", label: "Failover Logs" },
];

// ── Status helpers ──────────────────────────────

const STATUS_VARIANTS: Record<string, "success" | "warning" | "danger" | "default" | "info"> = {
  running: "success",
  idle: "default",
  paused: "warning",
  error: "danger",
};

const STATUS_COLORS: Record<string, string> = {
  running: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]",
  error: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)]",
  paused: "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]",
  idle: "bg-slate-500",
};

// ── Tool permissions ────────────────────────────

const PERMISSION_VARIANTS: Record<string, "success" | "warning" | "danger" | "default" | "info"> = {
  allow: "success",
  ask: "warning",
  deny: "danger",
};

// ── Metric Card ────────────────────────────────

function MetricCard({
  title,
  value,
  icon: Icon,
  subtitle,
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  subtitle?: string;
}) {
  return (
    <Card className="hover:border-slate-700/80 transition-colors">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold text-slate-100">{value}</p>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600/10">
            <Icon className="h-5 w-5 text-indigo-400" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tab 1: Overview ─────────────────────────────

function OverviewTab({ agentId }: { agentId: string }) {
  const { data: agentData } = useAgent(agentId);
  const { data: trendData, isLoading: trendLoading } = useCostTrend(agentId);
  const agent = agentData?.agent;
  const stats = agentData?.stats;
  const currentKey = agentData?.keyBindings?.[0];
  const model = agentData?.model;

  if (!agent) return null;

  const todayCalls = stats?.todayCalls ?? 0;
  const monthlyCost = stats?.monthlyCost ?? 0;
  const successRate = stats?.successRate != null
    ? (stats.successRate * 100).toFixed(1)
    : "—";

  return (
    <div className="space-y-5">
      {/* Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Today Calls"
          value={formatNumber(todayCalls)}
          icon={PhoneCall}
        />
        <MetricCard
          title="Monthly Cost"
          value={formatCurrency(monthlyCost)}
          icon={DollarSign}
        />
        <MetricCard
          title="Avg Cost / Call"
          value={
            todayCalls > 0
              ? formatCurrency(monthlyCost / Math.max(todayCalls, 1))
              : "$0.00"
          }
          icon={Activity}
        />
        <MetricCard
          title="Success Rate"
          value={`${successRate}%`}
          icon={CheckCircle2}
        />
      </div>

      {/* Current binding */}
      <Card>
        <CardHeader>
          <CardTitle>Current Binding</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-slate-500">Key</p>
              <p className="text-sm font-medium text-slate-200">
                {currentKey ? (
                  <>
                    {currentKey.keyLabel}{" "}
                    <span className="text-slate-500">({currentKey.provider.name})</span>
                  </>
                ) : (
                  <span className="text-slate-500">Not bound</span>
                )}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-slate-500">Model</p>
              <p className="text-sm font-medium text-slate-200">
                {model ? (
                  model.displayName || model.modelName
                ) : (
                  <span className="text-slate-500">Not set</span>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cost trend */}
      {trendLoading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          </CardContent>
        </Card>
      ) : (
        <CostTrend data={trendData?.trend || []} />
      )}
    </div>
  );
}

// ── Tab 2: Cost Breakdown ───────────────────────

function CostBreakdownTab({ agentId }: { agentId: string }) {
  const { data, error, isLoading } = useCostBreakdown(agentId);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    throw error;
  }

  if (!(data?.breakdown ?? []).length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <DollarSign className="h-10 w-10 text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">No cost data available</p>
        </CardContent>
      </Card>
    );
  }

  // Sort by cost descending
  const sorted = [...data.breakdown].sort((a, b) => b.cost - a.cost);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cost Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase">
                <th className="pb-2 pr-4 font-medium">Model</th>
                <th className="pb-2 pr-4 font-medium">Display Name</th>
                <th className="pb-2 pr-4 font-medium text-right">Input Tokens</th>
                <th className="pb-2 pr-4 font-medium text-right">Output Tokens</th>
                <th className="pb-2 pr-4 font-medium text-right">Cost</th>
                <th className="pb-2 font-medium text-right">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {sorted.map((item) => (
                <tr key={item.model} className="text-slate-300 hover:bg-slate-800/20">
                  <td className="py-2.5 pr-4">
                    <span
                      className="block max-w-[200px] truncate"
                      title={item.model}
                    >
                      {item.model}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-slate-500">
                    {item.displayName || "—"}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-400">
                    {formatNumber(item.tokensIn)}
                  </td>
                  <td className="py-2.5 pr-4 text-right text-slate-400">
                    {formatNumber(item.tokensOut)}
                  </td>
                  <td className="py-2.5 pr-4 text-right font-medium">
                    {formatCurrency(item.cost)}
                  </td>
                  <td className="py-2.5 text-right text-slate-400">
                    {item.percentage.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-700 text-sm font-medium text-slate-200">
                <td colSpan={4} className="py-3 pr-4 text-right">
                  Total
                </td>
                <td className="py-3 pr-4 text-right">{formatCurrency(data.total)}</td>
                <td className="py-3 text-right">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Tab 3: Permissions ─────────────────────────

function PermissionsTab({ agentId }: { agentId: string }) {
  const [data, setData] = useState<{ rules: Record<string, string>; safetyMode: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingTools, setPendingTools] = useState<Set<string>>(new Set());

  const loadPermissions = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    agents.getPermissions(agentId).then((res) => {
      if (!cancelled) setData(res as unknown as { rules: Record<string, string>; safetyMode: boolean });
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load permissions");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [agentId]);

  useEffect(() => {
    const cancel = loadPermissions();
    return cancel;
  }, [loadPermissions]);

  const togglePermission = async (tool: string) => {
    if (!data) return;
    const currentAction = data.rules[tool] || "deny";
    const newAction = currentAction === "allow" ? "deny" : "allow";

    // Optimistic update
    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, rules: { ...prev.rules, [tool]: newAction } };
    });

    setPendingTools((prev) => new Set(prev).add(tool));

    try {
      await agents.updatePermissions(agentId, {
        rules: {
          tools: {
            [tool]: newAction === "allow" ? { allow: true, deny: false } : { allow: false, deny: true },
          },
        },
      });
    } catch {
      // Rollback on failure
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, rules: { ...prev.rules, [tool]: currentAction } };
      });
    } finally {
      setPendingTools((prev) => {
        const next = new Set(prev);
        next.delete(tool);
        return next;
      });
    }
  };

  const toggleSafetyMode = async () => {
    if (!data) return;
    const newSafetyMode = !data.safetyMode;

    setData((prev) => {
      if (!prev) return prev;
      return { ...prev, safetyMode: newSafetyMode };
    });

    try {
      await agents.updatePermissions(agentId, { safetyMode: newSafetyMode });
    } catch {
      setData((prev) => {
        if (!prev) return prev;
        return { ...prev, safetyMode: !newSafetyMode };
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    throw error;
  }

  const allToolNames = ["edit", "bash", "read", "webfetch", "write"];
  const rules = data?.rules || {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool Permissions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {allToolNames.map((tool) => {
            const action = rules[tool] || "deny";
            const isPending = pendingTools.has(tool);
            return (
              <div
                key={tool}
                className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3"
              >
                <span className="text-sm font-medium text-slate-200 capitalize">{tool}</span>
                <button
                  onClick={() => togglePermission(tool)}
                  disabled={isPending}
                  className={cn(
                    "px-3 py-1 rounded text-xs font-medium transition-colors cursor-pointer border",
                    action === "allow"
                      ? "bg-green-600/20 text-green-400 border-green-700/50 hover:bg-green-600/30"
                      : "bg-red-600/20 text-red-400 border-red-700/50 hover:bg-red-600/30",
                    isPending && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin inline" />
                  ) : action === "allow" ? (
                    "Allow"
                  ) : (
                    "Deny"
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {data?.safetyMode !== undefined && (
          <div
            className="mt-4 flex items-center justify-between gap-2 rounded-lg bg-indigo-900/20 border border-indigo-800/40 px-4 py-3 cursor-pointer hover:bg-indigo-900/30 transition-colors"
            onClick={toggleSafetyMode}
          >
            <div className="flex items-center gap-2">
              <Shield className="h-4 w-4 text-indigo-400 shrink-0" />
              <div>
                <p className="text-xs font-medium text-indigo-300">Safety Mode</p>
                <p className="text-xs text-slate-400">
                  {data.safetyMode ? "Enabled — agent will ask before executing sensitive operations" : "Disabled"}
                </p>
              </div>
            </div>
            <span
              className={cn(
                "px-3 py-1 rounded text-xs font-medium transition-colors",
                data.safetyMode
                  ? "bg-green-600/20 text-green-400"
                  : "bg-slate-700/50 text-slate-400"
              )}
            >
              {data.safetyMode ? "On" : "Off"}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Tab 4: Failover Logs ────────────────────────

function FailoverLogsTab({ agentId }: { agentId: string }) {
  const [logs, setLogs] = useState<FailoverLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    agents.getFailoverLogs(agentId).then((res) => {
      if (!cancelled) setLogs(res.logs);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load failover logs");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [agentId]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    throw error;
  }

  if (!logs.length) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <Shield className="h-10 w-10 text-slate-600 mb-3" />
          <p className="text-sm text-slate-500">No failover records</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Failover History</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-start gap-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3"
            >
              {/* Timeline dot */}
              <div className="relative flex flex-col items-center">
                <div className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]" />
                <div className="mt-1 h-full w-px bg-slate-800" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-xs text-slate-500">
                  {new Date(log.timestamp).toLocaleString()}
                </p>
                <p className="mt-1 text-sm text-slate-200">
                  <span className="font-medium text-slate-300">{log.fromKey}</span>
                  {" → "}
                  <span className="font-medium text-slate-300">{log.toKey}</span>
                </p>
                <Badge variant="warning" className="mt-1 capitalize">
                  {log.reason}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main Page ──────────────────────────────────

export default function AgentDetailPage() {
  const params = useParams();
  const id = params?.id as string;

  const { data, error, isLoading, mutate } = useAgent(id);
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [loadedTabs, setLoadedTabs] = useState<Set<Tab>>(new Set(["overview"]));
  const [now, setNow] = useState(Date.now());

  const agent = data?.agent ?? null;

  // 每秒更新 now，让 "X 秒前" 实时跳动
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setLoadedTabs((prev) => new Set(prev).add(tab));
  };

  // ── Loading state ──────────────────────────
  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Skeleton header */}
        <div className="flex items-center gap-4">
          <div className="h-8 w-8 animate-pulse rounded-lg bg-slate-800" />
          <div className="h-6 w-48 animate-pulse rounded bg-slate-800" />
        </div>
        {/* Skeleton tabs */}
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-9 w-24 animate-pulse rounded-lg bg-slate-800" />
          ))}
        </div>
        {/* Skeleton content */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-slate-800" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-lg bg-slate-800" />
      </div>
    );
  }

  // ── 404 state ──────────────────────────────
  if (error?.message?.includes("404") || error?.message?.includes("not found")) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <span className="text-5xl">🔍</span>
        <h2 className="text-lg font-semibold text-slate-200">Agent 未找到</h2>
        <p className="text-sm text-slate-400">该 Agent 可能已被删除或不存在。</p>
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回仪表盘
        </Link>
      </div>
    );
  }

  // ── Error state (thrown to error.tsx) ─────
  if (error && !agent) {
    throw error;
  }

  if (!agent) return null;

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Dashboard
      </Link>

      {/* Agent header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-600/15">
            <Bot className="h-6 w-6 text-indigo-400" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-slate-100">{agent.name}</h2>
              <span
                className={cn(
                  "inline-block h-2.5 w-2.5 rounded-full",
                  STATUS_COLORS[agent.status] || "bg-slate-500"
                )}
              />
              <Badge variant={STATUS_VARIANTS[agent.status] || "default"}>
                {agent.status}
              </Badge>
            </div>
            <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
              <span>{agent.framework}</span>
              <span>·</span>
              <span>
                {agent.safetyMode ? "Safety: ON" : "Safety: OFF"}
              </span>
              <span>·</span>
              <span>Created {new Date(agent.createdAt).toLocaleDateString()}</span>
              {data?.lastUpdated && (
                <>
                  <span>·</span>
                  <span>
                    更新于 {Math.max(0, Math.floor((now - new Date(data.lastUpdated).getTime()) / 1000))} 秒前
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Enable toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {agent.enabled ? "Enabled" : "Disabled"}
          </span>
          <Toggle
            pressed={agent.enabled}
            onClick={async () => {
              const newEnabled = !agent.enabled;
              // Optimistic update
              mutate({ ...data, agent: { ...agent, enabled: newEnabled } }, false);
              try {
                await agents.update(id, { enabled: newEnabled });
                // Revalidate to get fresh data from server
                mutate();
              } catch {
                // Rollback on error
                mutate({ ...data, agent: { ...agent, enabled: agent.enabled } }, false);
              }
            }}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-800">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={cn(
              "px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
              activeTab === tab.key
                ? "border-indigo-400 text-indigo-300"
                : "border-transparent text-slate-500 hover:text-slate-300"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content — preserve loaded state */}
      <div>
        {activeTab === "overview" && <OverviewTab agentId={id} />}
        {(activeTab === "costs" || loadedTabs.has("costs")) && (
          <div style={{ display: activeTab === "costs" ? "" : "none" }}>
            <CostBreakdownTab agentId={id} />
          </div>
        )}
        {(activeTab === "permissions" || loadedTabs.has("permissions")) && (
          <div style={{ display: activeTab === "permissions" ? "" : "none" }}>
            <PermissionsTab agentId={id} />
          </div>
        )}
        {(activeTab === "failover" || loadedTabs.has("failover")) && (
          <div style={{ display: activeTab === "failover" ? "" : "none" }}>
            <FailoverLogsTab agentId={id} />
          </div>
        )}
      </div>
    </div>
  );
}