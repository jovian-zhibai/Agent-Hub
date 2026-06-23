"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useModels, useProviders } from "@/lib/hooks";
import type { Model, Provider } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, cn } from "@/lib/utils";
import {
  Settings,
  Sun,
  Moon,
  Download,
  Search,
} from "lucide-react";
import { useSettings } from "@/contexts/settings";

// ── Pricing source helpers ──────────────────────

const PRICING_SOURCE_ICONS: Record<string, string> = {
  litellm: "🟢",
  openrouter: "🟡",
  manual: "🔵",
};

const PRICING_SOURCE_VARIANTS: Record<string, "success" | "warning" | "danger" | "default" | "info"> = {
  litellm: "success",
  openrouter: "warning",
  manual: "info",
  unknown: "default",
};

function getPricingSourceIcon(source?: string): string {
  return PRICING_SOURCE_ICONS[source || ""] || "⚪";
}

// ── Main Settings Page ──────────────────────────

export default function SettingsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const { settings, setTheme } = useSettings();
  const { dark } = { dark: settings.theme === "dark" };
  const toggleTheme = useCallback(() => {
    setTheme(dark ? "light" : "dark");
  }, [dark, setTheme]);

  const { data: modelsData, error: modelsError, isLoading: modelsLoading } = useModels(
    providerFilter !== "all" ? providerFilter : undefined
  );
  const { data: providersData, isLoading: providersLoading } = useProviders();

  const isLoading = modelsLoading || (providersLoading && !providersData);
  const modelList: Model[] = modelsData?.models ?? [];
  const providerList: Provider[] = providersData?.providers ?? [];

  // Filter by search
  const filteredModels = modelList.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.modelName.toLowerCase().includes(q) ||
      (m.displayName || "").toLowerCase().includes(q)
    );
  });

  // ── Loading state ──────────────────────────
  if (isLoading && !modelList.length) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Settings</h2>
          <p className="text-xs text-slate-500 mt-1">
            Manage pricing, theme, and data export
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="h-48 animate-pulse rounded-lg bg-slate-800 lg:col-span-2" />
          <div className="h-48 animate-pulse rounded-lg bg-slate-800" />
        </div>
      </div>
    );
  }

  // ── Error state (thrown to error.tsx) ─────
  if (modelsError && !modelList.length) {
    throw modelsError;
  }

  // Group providers for filter
  const filterProviders = [
    { id: "all", name: "All Providers" },
    ...providerList,
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Settings</h2>
        <p className="text-xs text-slate-500 mt-1">
          Manage pricing, theme, and data export
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: Model pricing table */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Model Pricing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Filters */}
              <div className="flex flex-col gap-3 sm:flex-row">
                {/* Search */}
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search models..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/50 pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Provider filter */}
                <select
                  value={providerFilter}
                  onChange={(e) => setProviderFilter(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
                >
                  {filterProviders.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Table */}
              {modelList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <span className="text-4xl mb-3">📊</span>
                  <p className="text-sm font-semibold text-slate-200">
                    暂无模型定价数据
                  </p>
                  <p className="mt-1.5 text-xs text-slate-400 max-w-xs text-center">
                    添加 API Key 后，系统会自动拉取模型列表并匹配定价。也可以手动添加定价。
                  </p>
                  <Link
                    href="/keys"
                    className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
                  >
                    去添加 Key
                  </Link>
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Search className="h-10 w-10 text-slate-600 mb-3" />
                  <p className="text-sm text-slate-500">No models found</p>
                  {(searchQuery || providerFilter !== "all") && (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setProviderFilter("all");
                      }}
                      className="mt-2 text-xs text-indigo-400 hover:text-indigo-300"
                    >
                      Clear filters
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs text-slate-500 uppercase">
                        <th className="pb-2 pr-4 font-medium">Model</th>
                        <th className="pb-2 pr-4 font-medium">Display Name</th>
                        <th className="pb-2 pr-4 font-medium">Provider</th>
                        <th className="pb-2 pr-4 font-medium text-right">Input Price</th>
                        <th className="pb-2 pr-4 font-medium text-right">Output Price</th>
                        <th className="pb-2 font-medium">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50">
                      {filteredModels
                        .sort((a, b) => a.modelName.localeCompare(b.modelName))
                        .map((model) => (
                          <tr
                            key={model.id}
                            className="text-slate-300 hover:bg-slate-800/20"
                          >
                            <td className="py-2.5 pr-4">
                              <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-mono">
                                {model.modelName}
                              </code>
                            </td>
                            <td className="py-2.5 pr-4 text-slate-400">
                              {model.displayName || "—"}
                            </td>
                            <td className="py-2.5 pr-4">
                              <span className="text-slate-400">
                                {model.provider?.name || "—"}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 text-right text-slate-400">
                              {model.pricingInput != null
                                ? formatCurrency(model.pricingInput)
                                : "—"}
                            </td>
                            <td className="py-2.5 pr-4 text-right text-slate-400">
                              {model.pricingOutput != null
                                ? formatCurrency(model.pricingOutput)
                                : "—"}
                            </td>
                            <td className="py-2.5">
                              <Badge
                                variant={
                                  PRICING_SOURCE_VARIANTS[model.pricingSource || "unknown"] || "default"
                                }
                                className="capitalize"
                              >
                                {getPricingSourceIcon(model.pricingSource)}{" "}
                                {model.pricingSource || "unknown"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: Theme + Export */}
        <div className="space-y-4">
          {/* Theme */}
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {dark ? (
                    <Moon className="h-5 w-5 text-indigo-400" />
                  ) : (
                    <Sun className="h-5 w-5 text-amber-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      {dark ? "Dark Mode" : "Light Mode"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Switch between dark and light themes
                    </p>
                  </div>
                </div>
                <button
                  onClick={toggleTheme}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors",
                    "border-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                    dark
                      ? "bg-indigo-600 hover:bg-indigo-500"
                      : "bg-slate-700 hover:bg-slate-600"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                      dark ? "translate-x-6" : "translate-x-0.5"
                    )}
                  />
                </button>
              </div>
            </CardContent>
          </Card>

          {/* Export */}
          <Card>
            <CardHeader>
              <CardTitle>Data Export</CardTitle>
            </CardHeader>
            <CardContent>
              <button
                disabled
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-500 opacity-60 cursor-not-allowed"
              >
                <Download className="h-4 w-4" />
                Export Usage Data
              </button>
              <p className="mt-2 text-xs text-slate-500 text-center">
                Coming soon — export your usage data as CSV
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
