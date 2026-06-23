import useSWR from "swr";
import { fetcher } from "./api";

// ── Dashboard ────────────────────────────────────

export function useDashboard() {
  return useSWR("/v1/dashboard", fetcher, {
    refreshInterval: 5000,     // 5秒轮询
    revalidateOnFocus: true,
    revalidateIfHidden: false,
  });
}

// ── Agents ───────────────────────────────────────

export function useAgents() {
  return useSWR("/v1/agents", fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: true,
    revalidateIfHidden: false,
  });
}

export function useAgent(id: string) {
  return useSWR(id ? `/v1/agents/${id}` : null, fetcher, {
    refreshInterval: 5000,    // 5秒轮询
    revalidateOnFocus: true,
    revalidateIfHidden: false,
  });
}

export function useCostTrend(agentId: string, range = "7d") {
  return useSWR(`/v1/agents/${agentId}/cost-trend?range=${range}`, fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: true,
    revalidateIfHidden: false,
  });
}

export function useCostBreakdown(agentId: string, range = "7d") {
  return useSWR(`/v1/agents/${agentId}/cost-breakdown?range=${range}`, fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: true,
    revalidateIfHidden: false,
  });
}

// ── Keys ─────────────────────────────────────────

export function useKeys(params?: string) {
  return useSWR(`/v1/keys${params ? `?${params}` : ""}`, fetcher, {
    refreshInterval: 10000,   // Key 列表 10 秒
    revalidateOnFocus: true,
    revalidateIfHidden: false,
  });
}

export function useKeyUsage(keyId: string, range = "7d") {
  return useSWR(keyId ? `/v1/keys/${keyId}/usage?range=${range}` : null, fetcher, {
    refreshInterval: 10000,
    revalidateOnFocus: true,
    revalidateIfHidden: false,
  });
}

// ── Models / Providers ───────────────────────────

export function useModels(providerId?: string) {
  return useSWR(`/v1/models${providerId ? `?providerId=${providerId}` : ""}`, fetcher, {
    refreshInterval: 120000,  // 定价表 2 分钟刷新一次够了
    revalidateOnFocus: false, // focus 没必要刷新定价
    revalidateIfHidden: false,
  });
}

export function useProviders() {
  return useSWR("/v1/providers", fetcher, {
    refreshInterval: 300000,  // provider 列表 5 分钟一次
    revalidateOnFocus: false,
    revalidateIfHidden: false,
  });
}
