"use client";

import Link from "next/link";
import { useDashboard } from "@/lib/hooks";
import { formatCurrency, formatNumber } from "@/lib/utils";

import MetricCard from "@/components/dashboard/metric-card";
import AgentGrid from "@/components/dashboard/agent-grid";
import CostTrend from "@/components/dashboard/cost-trend";
import KeyOverview from "@/components/dashboard/key-overview";

import {
  Bot,
  KeyRound,
  PhoneCall,
  ShieldBan,
} from "lucide-react";

export default function DashboardPage() {
  const { data, error, isLoading } = useDashboard();

  // ── Loading state ──────────────────────────
  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  // ── Error state (thrown to error.tsx) ─────
  if (error && !data) {
    throw error;
  }

  // ── Empty state: no agents ───────────────
  if (data && !data.agentList.length) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Dashboard</h2>
          <p className="text-xs text-slate-500 mt-1">
            Overview of your agents, keys, and usage
          </p>
        </div>
        <div className="flex flex-col items-center justify-center py-20">
          <span className="text-5xl mb-4">🤖</span>
          <h3 className="text-lg font-semibold text-slate-200">
            你还没有连接任何 Agent
          </h3>
          <p className="mt-2 text-sm text-slate-400 max-w-md text-center">
            Agent Hub 通过 CLI 连接本地运行的 Agent。在终端执行以下命令：
          </p>
          <div className="mt-5 rounded-lg bg-slate-800 px-6 py-3.5">
            <code className="text-sm font-mono text-emerald-400">
              agent-hub connect
            </code>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            扫描本地 OPC Agent 并注册到面板
          </p>
          <p className="mt-1 text-xs text-slate-500">
            连接成功后刷新页面即可看到数据
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            我已经连接好了，刷新页面
          </button>
        </div>
      </div>
    );
  }

  // ── Loaded ─────────────────────────────────
  const m = data?.metrics;

  return (
    <div className="space-y-6">
      {/* Page title */}
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Dashboard</h2>
        <p className="text-xs text-slate-500 mt-1">
          Overview of your agents, keys, and usage
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Agents"
          value={m ? formatNumber(m.agentCount) : "—"}
          subtitle={
            m
              ? `${m.agentRunning} running · ${m.agentError} errors`
              : undefined
          }
          icon={Bot}
        />
        <MetricCard
          title="Keys"
          value={m ? formatNumber(m.keyCount) : "—"}
          subtitle={
            m
              ? `${m.keyHealthy} healthy · ${m.keyWarning} warnings`
              : undefined
          }
          icon={KeyRound}
        />
        <MetricCard
          title="Today Calls"
          value={m ? formatNumber(m.totalCallsToday) : "—"}
          icon={PhoneCall}
        />
        <MetricCard
          title="Intercepts"
          value={m ? formatNumber(m.interceptsToday) : "—"}
          icon={ShieldBan}
          subtitle={
            m && m.totalCostThisMonth > 0
              ? `$${m.totalCostThisMonth.toFixed(2)} this month`
              : undefined
          }
        />
      </div>

      {/* Cost trend + Key overview */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CostTrend data={data?.costTrend || []} />
        </div>
        <div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 backdrop-blur-sm p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-3">
              Key Overview
            </h3>
            {data && data.agentList.length > 0 && data.metrics.keyCount === 0 ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <span className="text-2xl">🔑</span>
                <p className="text-sm text-slate-400 text-center">
                  还没有添加 API Key，Agent 无法调用模型。
                </p>
                <Link
                  href="/keys"
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
                >
                  去添加 Key
                </Link>
              </div>
            ) : (
              <KeyOverview keys={data?.keyOverview || []} />
            )}
          </div>
        </div>
      </div>

      {/* Agent grid */}
      <div>
        <h3 className="text-sm font-semibold text-slate-300 mb-3">
          Agents ({data?.agentList.length || 0})
        </h3>
        <AgentGrid projects={data?.projects || []} />
      </div>
    </div>
  );
}