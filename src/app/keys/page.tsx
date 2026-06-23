"use client";

import { useState, useEffect } from "react";
import { useKeys, useKeyUsage } from "@/lib/hooks";
import { keys, type Key, type KeyUsageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Toggle } from "@/components/ui/toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, cn } from "@/lib/utils";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  KeyRound,
  Plus,
  RefreshCw,
  AlertCircle,
  Trash2,
  TestTube,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  XCircle,
  Bot,
} from "lucide-react";
// ── Helpers ─────────────────────────────────────

const PROVIDER_ICONS: Record<string, string> = {
  OpenAI: "🤖",
  Anthropic: "🧠",
  DeepSeek: "🌊",
  Google: "🔮",
};

const HEALTH_ICONS: Record<string, string> = {
  normal: "🟢",
  warning: "🟡",
  rate_limited: "🔴",
  invalid: "❌",
  stale: "⚪",
};

const HEALTH_VARIANTS: Record<string, "success" | "warning" | "danger" | "default" | "info"> = {
  normal: "success",
  warning: "warning",
  rate_limited: "danger",
  invalid: "danger",
  stale: "default",
};

function getProviderIcon(name: string): string {
  return PROVIDER_ICONS[name] || "🔑";
}

// ── Small Chart ─────────────────────────────────

function UsageChart({ data }: { data: { date: string; cost: number }[] }) {
  if (!data.length) {
    return (
      <div className="flex h-32 items-center justify-center text-xs text-slate-500">
        No usage data
      </div>
    );
  }
  return (
    <div className="h-32">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "#64748b", fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: "#1e293b" }}
          />
          <YAxis
            tick={{ fill: "#64748b", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${v.toFixed(2)}`}
          />
          <Tooltip
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 shadow-lg">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="text-sm font-semibold text-slate-100">
                    {formatCurrency((payload[0]?.value as number) || 0)}
                  </p>
                </div>
              ) : null
            }
          />
          <Bar dataKey="cost" fill="#6366f1" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Add Key Modal ───────────────────────────────

type Step = 1 | 2 | 3;

const DEFAULT_BASE_URLS: Record<string, string> = {
  OpenAI: "https://api.openai.com/v1",
  Anthropic: "https://api.anthropic.com",
  DeepSeek: "https://api.deepseek.com",
  Google: "https://generativelanguage.googleapis.com",
};

interface AddKeyModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function AddKeyModal({ open, onClose, onSuccess }: AddKeyModalProps) {
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 state
  const [providerName, setProviderName] = useState("OpenAI");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URLS["OpenAI"]);
  const [keyLabel, setKeyLabel] = useState("");
  const [scope, setScope] = useState<"personal" | "workspace">("personal");
  const [initialBalance, setInitialBalance] = useState("");
  const [deepSeekProtocol, setDeepSeekProtocol] = useState<"openai" | "anthropic">("openai");

  // Step 2 state
  const [createdKeyId, setCreatedKeyId] = useState<string | null>(null);
  const [discoverResult, setDiscoverResult] = useState<{
    matched: number;
    unmatched: number;
    models: { modelName: string; displayName: string }[];
  } | null>(null);

  // Step 3 state
  const [finalError, setFinalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setLoading(false);
      setError(null);
      setProviderName("OpenAI");
      setApiKey("");
      setShowKey(false);
      setBaseUrl(DEFAULT_BASE_URLS["OpenAI"]);
      setKeyLabel("");
      setScope("personal");
      setInitialBalance("");
      setDeepSeekProtocol("openai");
      setCreatedKeyId(null);
      setDiscoverResult(null);
      setFinalError(null);
    }
  }, [open]);

  const handleProviderChange = (val: string) => {
    setProviderName(val);
    setBaseUrl(DEFAULT_BASE_URLS[val] || "");
    if (val !== "DeepSeek") {
      setDeepSeekProtocol("openai");
    }
  };

  const handleCreateAndDiscover = async () => {
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        provider: providerName,
        keyValue: apiKey,
        baseUrl,
        label: keyLabel || undefined,
        scope,
        protocol: providerName === "DeepSeek"
          ? (deepSeekProtocol === "anthropic" ? "anthropic" : "openai")
          : "messages",
      };
      if (initialBalance) payload.initialBalance = parseFloat(initialBalance);

      const createRes = await keys.create(payload);
      const keyId = createRes.key.id;
      setCreatedKeyId(keyId);

      setStep(2);

      const discRes = await keys.discoverModels(keyId);
      setDiscoverResult({
        matched: discRes.matched ?? discRes.models.length,
        unmatched: discRes.unmatched ?? 0,
        models: discRes.models,
      });

      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setLoading(false);
    }
  };

  const handleDone = () => {
    onSuccess();
    onClose();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
          {/* Header */}
          <div className="mb-5 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-slate-100">
              {step === 1 && "Add API Key"}
              {step === 2 && "Discovering Models..."}
              {step === 3 && "Key Added"}
            </Dialog.Title>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map((s) => (
                <span
                  key={s}
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors",
                    s === step
                      ? "bg-indigo-600 text-white"
                      : s < step
                        ? "bg-emerald-900/40 text-emerald-300"
                        : "bg-slate-800 text-slate-500"
                  )}
                >
                  {s < step ? <CheckCircle2 className="h-3.5 w-3.5" /> : s}
                </span>
              ))}
            </div>
          </div>

          {/* Step 1: Form */}
          {step === 1 && (
            <div className="space-y-4">
              {/* Provider */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Provider</label>
                <Select.Root value={providerName} onValueChange={handleProviderChange}>
                  <Select.Trigger className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none">
                    <Select.Value />
                    <Select.Icon>
                      <ChevronDown className="h-4 w-4 text-slate-400" />
                    </Select.Icon>
                  </Select.Trigger>
                  <Select.Portal>
                    <Select.Content className="z-[60] rounded-lg border border-slate-700 bg-slate-800 p-1 shadow-xl">
                      {["OpenAI", "Anthropic", "DeepSeek", "Google"].map((p) => (
                        <Select.Item
                          key={p}
                          value={p}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-200 hover:bg-slate-700 focus:bg-slate-700 focus:outline-none"
                        >
                          <span>{getProviderIcon(p)}</span>
                          <Select.ItemText>{p}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Portal>
                </Select.Root>
              </div>

              {/* DeepSeek protocol selector */}
              {providerName === "DeepSeek" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Protocol</label>
                  <div className="flex gap-2">
                    {(["openai", "anthropic"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setDeepSeekProtocol(p)}
                        className={cn(
                          "flex-1 rounded-lg border px-3 py-2 text-sm transition-colors",
                          deepSeekProtocol === p
                            ? "border-indigo-500 bg-indigo-600/10 text-indigo-300"
                            : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
                        )}
                      >
                        {p === "openai" ? "OpenAI Compatible" : "Anthropic Compatible"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* API Key */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">API Key</label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 pr-10 text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Base URL */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Base URL</label>
                <input
                  type="text"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Label */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Label</label>
                <input
                  type="text"
                  value={keyLabel}
                  onChange={(e) => setKeyLabel(e.target.value)}
                  placeholder="My API Key"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {/* Scope */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Scope</label>
                <div className="flex gap-2">
                  {(["personal", "workspace"] as const).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setScope(s)}
                      className={cn(
                        "flex-1 rounded-lg border px-3 py-2 text-sm capitalize transition-colors",
                        scope === s
                          ? "border-indigo-500 bg-indigo-600/10 text-indigo-300"
                          : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Initial Balance */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">
                  Initial Balance <span className="text-slate-500">(optional)</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={initialBalance}
                  onChange={(e) => setInitialBalance(e.target.value)}
                  placeholder="0.00"
                  className="w-full rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-lg bg-red-900/20 border border-red-800/40 px-3 py-2 text-xs text-red-300">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {error}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateAndDiscover}
                  disabled={loading || !apiKey}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Confirm & Detect"
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Discovering */}
          {step === 2 && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="h-10 w-10 animate-spin text-indigo-400" />
              <p className="text-sm text-slate-300">Connecting to provider service...</p>
              <p className="text-xs text-slate-500">Fetching available models</p>
            </div>
          )}

          {/* Step 3: Result */}
          {step === 3 && discoverResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg bg-emerald-900/20 border border-emerald-800/40 px-4 py-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-400" />
                <div>
                  <p className="text-sm font-medium text-emerald-300">Key created successfully</p>
                  <p className="text-xs text-slate-400">
                    {discoverResult.matched} models matched
                    {discoverResult.unmatched > 0 && `, ${discoverResult.unmatched} unmatched`}
                  </p>
                </div>
              </div>

              {discoverResult.models.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-slate-400">Discovered Models</p>
                  <div className="max-h-40 space-y-1 overflow-y-auto">
                    {discoverResult.models.map((m) => (
                      <div
                        key={m.modelName}
                        className="flex items-center gap-2 rounded-md bg-slate-800/50 px-3 py-1.5 text-xs text-slate-300"
                      >
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" />
                        <span className="truncate">{m.modelName}</span>
                        {m.displayName && (
                          <span className="shrink-0 text-slate-500">({m.displayName})</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {finalError && (
                <div className="flex items-center gap-2 rounded-lg bg-red-900/20 border border-red-800/40 px-3 py-2 text-xs text-red-300">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  {finalError}
                </div>
              )}

              <button
                type="button"
                onClick={handleDone}
                className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
              >
                Done
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Delete Confirm Dialog ───────────────────────

function DeleteConfirmDialog({
  open,
  onClose,
  onConfirm,
  keyLabel,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  keyLabel: string;
  loading: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
          <Dialog.Title className="mb-2 text-base font-semibold text-slate-100">
            Delete Key
          </Dialog.Title>
          <p className="mb-5 text-sm text-slate-400">
            Are you sure you want to delete <strong className="text-slate-200">{keyLabel}</strong>?
            This action cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-400 hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Delete
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ── Key Row ─────────────────────────────────────

interface KeyRowProps {
  keyItem: Key;
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  testingIds: Set<string>;
}

function KeyRow({ keyItem, onDelete, onTest, testingIds }: KeyRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [usageData, setUsageData] = useState<KeyUsageResponse | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

  const providerName = keyItem.provider?.name || keyItem.providerId || "Unknown";
  const health = keyItem.health || "unknown";

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !usageData) {
      setUsageLoading(true);
      keys
        .getUsage(keyItem.id)
        .then(setUsageData)
        .catch(() => {})
        .finally(() => setUsageLoading(false));
    }
  };

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40">
      {/* Row header — clickable */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggle(); } }}
        className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-slate-800/30"
      >
        {/* Expand icon */}
        <span className="shrink-0 text-slate-500">
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </span>

        {/* Provider icon */}
        <span className="text-lg">{getProviderIcon(providerName)}</span>

        {/* Label + Provider name */}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-200 truncate">
            {keyItem.keyLabel || keyItem.label || "Unnamed Key"}
          </p>
          <p className="text-xs text-slate-500">{providerName}</p>
        </div>

        {/* Masked key */}
        <code className="hidden shrink-0 rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-400 font-mono sm:block">
          {keyItem.keyPrefix || "—"}
        </code>

        {/* Health badge */}
        <Badge variant={HEALTH_VARIANTS[health] || "default"} className="shrink-0 capitalize">
          {HEALTH_ICONS[health] || "⚪"} {health}
        </Badge>

        {/* Balance */}
        <div className="hidden shrink-0 text-right md:block">
          <p className="text-xs text-slate-300">
            {keyItem.initialBalance != null ? `$${keyItem.initialBalance.toFixed(2)}` : "Unlimited"}
          </p>
          {keyItem.burnRate != null && (
            <p className="text-xs text-slate-500">${keyItem.burnRate.toFixed(2)}/d</p>
          )}
        </div>

        {/* Agent count */}
        <div className="hidden shrink-0 text-right lg:block">
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <Bot className="h-3 w-3" />
            <span>{keyItem.agentCount ?? 0}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTest(keyItem.id);
            }}
            disabled={testingIds.has(keyItem.id)}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
            title="Test key"
          >
            {testingIds.has(keyItem.id) ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <TestTube className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(keyItem.id);
            }}
            className="rounded-md p-1.5 text-slate-500 hover:bg-red-900/30 hover:text-red-400 transition-colors"
            title="Delete key"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-slate-800 px-4 py-4">
          {usageLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
            </div>
          ) : (
            <div className="space-y-5">
              {/* TODO: Failover configuration UI removed — the key update endpoint
                  (updateKeySchema) does not accept failoverKeyId and there is no
                  separate key-failover endpoint. Re-enable once the backend
                  exposes a way to configure key failover relationships. */}

              {/* Usage chart */}
              <div>
                <p className="mb-1.5 text-xs font-medium text-slate-400">7-Day Consumption</p>
                <UsageChart data={usageData?.dailyTrend || []} />
              </div>

              {/* By-agent breakdown */}
              {usageData?.byAgent && usageData.byAgent.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-slate-400">By Agent</p>
                  <div className="space-y-1">
                    {usageData.byAgent.map((a) => (
                      <div
                        key={a.agentId}
                        className="flex items-center justify-between rounded-md bg-slate-800/30 px-3 py-1.5"
                      >
                        <span className="text-xs text-slate-300">{a.agentName}</span>
                        <span className="text-xs font-medium text-slate-400">
                          {formatCurrency(a.cost)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary */}
              {usageData && (
                <div className="text-xs text-slate-500">
                  Total: <span className="font-medium text-slate-300">{formatCurrency(usageData?.usage.totalCost ?? 0)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Page ──────────────────────────────────

export default function KeysPage() {
  const { data, error, isLoading, mutate } = useKeys();
  const [addOpen, setAddOpen] = useState(false);
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<Key | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const keyList = data?.keys ?? [];

  const handleTest = async (id: string) => {
    setTestingIds((prev) => new Set(prev).add(id));
    setActionError(null);
    try {
      await keys.test(id);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTestingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    setActionError(null);
    try {
      await keys.delete(deleteTarget.id);
      mutate();
      setDeleteTarget(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleteLoading(false);
    }
  };

  // ── Loading state ──────────────────────────
  if (isLoading && !keyList.length) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Key Management</h2>
            <p className="text-xs text-slate-500 mt-1">Manage your API keys</p>
          </div>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-lg bg-slate-800/50"
            />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state (thrown to error.tsx) ─────
  if (error && !keyList.length) {
    throw error;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Key Management</h2>
          <p className="text-xs text-slate-500 mt-1">Manage your API keys</p>
        </div>
        <button
          onClick={() => setAddOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Key
        </button>
      </div>

      {/* Action error banner */}
      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-800/40 bg-red-900/20 px-3 py-2 text-xs text-red-300">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {actionError}
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="ml-auto text-red-400 hover:text-red-200"
          >
            ✕
          </button>
        </div>
      )}

      {/* Empty state */}
      {!keyList.length && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <span className="text-5xl mb-4">🔑</span>
            <p className="text-base font-semibold text-slate-200">
              添加你的第一个 API Key
            </p>
            <p className="mt-2 text-sm text-slate-400 max-w-sm text-center">
              添加 Key 后，系统会自动拉取可用模型列表并匹配定价。
            </p>
            <button
              onClick={() => setAddOpen(true)}
              className="mt-5 flex items-center gap-2 rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
            >
              <Plus className="h-4 w-4" />
              添加 Key
            </button>
          </CardContent>
        </Card>
      )}

      {/* Key list */}
      {keyList.length > 0 && (
        <div className="space-y-2">
          {keyList.map((k: Key) => (
            <KeyRow
              key={k.id}
              keyItem={k}
              onDelete={(id) => {
                const target = keyList.find((k2: Key) => k2.id === id);
                if (target) setDeleteTarget(target);
              }}
              onTest={handleTest}
              testingIds={testingIds}
            />
          ))}
        </div>
      )}

      {/* Add Key Modal */}
      <AddKeyModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={() => mutate()}
      />

      {/* Delete confirm dialog */}
      <DeleteConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        keyLabel={deleteTarget?.keyLabel || deleteTarget?.label || ""}
        loading={deleteLoading}
      />
    </div>
  );
}
