"use client";

import { useState, useMemo } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  ScrollText,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Filter,
} from "lucide-react";

// ── Types ──────────────────────────────────────

interface AuditLog {
  id: string;
  action: string;
  operatorId: string | null;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  createdAt: string;
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

interface AuditLogsResponse {
  logs: AuditLog[];
  pagination: Pagination;
}

// ── Action labels ──────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  key_added: "Key Added",
  key_deleted: "Key Deleted",
  key_updated: "Key Updated",
  permission_changed: "Permission Changed",
  agent_created: "Agent Created",
  agent_updated: "Agent Updated",
  agent_deleted: "Agent Deleted",
};

const ACTION_OPTIONS = Object.keys(ACTION_LABELS);

const TARGET_TYPE_OPTIONS = ["agent", "key", "workspace"];

// ── Helpers ────────────────────────────────────

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncateDetails(details: Record<string, unknown>): string {
  const json = JSON.stringify(details);
  return json.length > 80 ? json.slice(0, 80) + "…" : json;
}

// ── Main Page ──────────────────────────────────

export default function AuditLogsPage() {
  // Filters
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // Pagination
  const [page, setPage] = useState(1);
  const limit = 20;

  // Build query string
  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("limit", String(limit));
    if (action) params.set("action", action);
    if (targetType) params.set("targetType", targetType);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to + "T23:59:59.999Z").toISOString());
    return params.toString();
  }, [page, limit, action, targetType, from, to]);

  const { data, error, isLoading } = useSWR<AuditLogsResponse>(
    `/v1/audit-logs?${queryString}`,
    fetcher,
    {
      revalidateOnFocus: true,
    }
  );

  const logs = data?.logs ?? [];
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;
  const currentPage = pagination?.page ?? page;

  const handleFilterChange = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };

  const handleReset = () => {
    setAction("");
    setTargetType("");
    setFrom("");
    setTo("");
    setPage(1);
  };

  const hasFilters = action || targetType || from || to;

  // ── Loading state ──────────────────────────
  if (isLoading && !logs.length) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Audit Logs</h2>
          <p className="text-xs text-slate-500 mt-1">
            Track all key and permission changes
          </p>
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-lg bg-slate-800/50"
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state (thrown to error.tsx) ─────
  if (error && !logs.length) {
    throw error;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600/15">
          <ScrollText className="h-5 w-5 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Audit Logs</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Track all key and permission changes
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <Filter className="h-3.5 w-3.5" />
              Filters
            </div>

            {/* Action filter */}
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-slate-500">Action</label>
              <select
                value={action}
                onChange={(e) => handleFilterChange(setAction)(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
              >
                <option value="">All Actions</option>
                {ACTION_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABELS[a]}
                  </option>
                ))}
              </select>
            </div>

            {/* Target type filter */}
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-slate-500">Target Type</label>
              <select
                value={targetType}
                onChange={(e) => handleFilterChange(setTargetType)(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none capitalize"
              >
                <option value="">All Types</option>
                {TARGET_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t} className="capitalize">
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* From date */}
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-slate-500">From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => handleFilterChange(setFrom)(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none [color-scheme:dark]"
              />
            </div>

            {/* To date */}
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-slate-500">To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => handleFilterChange(setTo)(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none [color-scheme:dark]"
              />
            </div>

            {/* Reset */}
            {hasFilters && (
              <button
                onClick={handleReset}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Loading overlay (when refetching with existing data) */}
      {isLoading && logs.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Updating...
        </div>
      )}

      {/* Table */}
      {logs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <span className="text-5xl mb-4">📜</span>
            <p className="text-base font-semibold text-slate-200">
              No audit logs found
            </p>
            <p className="mt-2 text-sm text-slate-400 max-w-sm text-center">
              {hasFilters
                ? "Try adjusting your filters to see more results."
                : "Audit logs will appear here once actions are recorded."}
            </p>
            {hasFilters && (
              <button
                onClick={handleReset}
                className="mt-4 text-xs text-indigo-400 hover:text-indigo-300"
              >
                Clear filters
              </button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase">
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Target Type</th>
                    <th className="px-4 py-3 font-medium">Target ID</th>
                    <th className="px-4 py-3 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/50">
                  {logs.map((log) => (
                    <tr
                      key={log.id}
                      className="text-slate-300 hover:bg-slate-800/20"
                    >
                      <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
                            log.action.startsWith("key_")
                              ? "bg-indigo-600/15 text-indigo-300"
                              : log.action.startsWith("agent_")
                                ? "bg-emerald-600/15 text-emerald-300"
                                : "bg-amber-600/15 text-amber-300"
                          )}
                        >
                          {ACTION_LABELS[log.action] || log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 capitalize">
                        {log.targetType}
                      </td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-mono text-slate-400">
                          {log.targetId.slice(0, 8)}…
                        </code>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono max-w-xs truncate">
                        {truncateDetails(log.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {logs.length > 0 && pagination && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Showing{" "}
            <span className="font-medium text-slate-300">
              {(currentPage - 1) * limit + 1}
            </span>
            –
            <span className="font-medium text-slate-300">
              {Math.min(currentPage * limit, pagination.total)}
            </span>{" "}
            of{" "}
            <span className="font-medium text-slate-300">
              {pagination.total}
            </span>{" "}
            logs
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Prev
            </button>
            <span className="text-xs text-slate-400">
              Page{" "}
              <span className="font-medium text-slate-200">{currentPage}</span>{" "}
              of{" "}
              <span className="font-medium text-slate-200">{totalPages}</span>
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="flex items-center gap-1 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
