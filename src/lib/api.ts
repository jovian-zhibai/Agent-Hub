// ──────────────────────────────────────────────
// API Client — Agent Hub Frontend
// ──────────────────────────────────────────────

const RAW_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const API_BASE = RAW_BASE.endsWith("/api") ? RAW_BASE : `${RAW_BASE}/api`;

// ── Generic fetch wrapper ─────────────────────

async function fetchAPI<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("auth_token")
      : null;

  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `API error: ${res.status}`);
  }

  return res.json();
}

// ── Types ──────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  framework: string;
  status: string;
  enabled: boolean;
  safetyMode: boolean;
  model: { modelName: string; displayName: string } | null;
  currentKey: {
    keyId: string;
    keyLabel: string;
    provider: { name: string };
  } | null;
  todayCalls: number;
  monthlyCost: number;
  lastHeartbeat: string | null;
  createdAt: string;
  projectName: string;
  projectPath: string;
}

export interface DashboardMetrics {
  agentCount: number;
  agentRunning: number;
  agentError: number;
  keyCount: number;
  keyHealthy: number;
  keyWarning: number;
  totalCostThisMonth: number;
  totalCallsToday: number;
  interceptsToday: number;
}

export interface CostTrendPoint {
  date: string;
  cost: number;
}

export interface KeyOverviewItem {
  id: string;
  keyLabel: string;
  provider: { name: string };
  health: string;
  remaining: number | null;
  burnRate: number | null;
}

export interface DashboardResponse {
  metrics: DashboardMetrics;
  agentList: Agent[];
  projects: {
    projectName: string;
    agents: Agent[];
  }[];
  costTrend: CostTrendPoint[];
  keyOverview: KeyOverviewItem[];
}

export interface AgentDetailResponse {
  agent: Agent;
}

export interface CostPoint {
  date: string;
  cost: number;
}

export interface CostBreakdownItem {
  model: string;
  cost: number;
  percentage: number;
}

export interface CostBreakdownResponse {
  breakdown: CostBreakdownItem[];
  total: number;
}

export interface Key {
  id: string;
  keyLabel: string;
  providerId: string;
  provider?: { name: string; displayName: string };
  health: string;
  keyValue?: string;
  baseUrl?: string;
  scope?: string;
  initialBalance: number | null;
  burnRate: number | null;
  modelCount?: number;
  agentCount?: number;
  createdAt: string;
  failoverKeyId?: string | null;
  label?: string;
}

export interface KeyUsageResponse {
  usage: { date: string; cost: number }[];
  total: number;
  byAgent: { agentId: string; agentName: string; cost: number }[];
}

export interface DiscoverModelsResponse {
  models: { modelName: string; displayName: string }[];
  matched: number;
  unmatched: number;
}

export interface PermissionEntry {
  tool: string;
  action: "allow" | "deny" | "ask";
}

export interface PermissionsResponse {
  permissions: PermissionEntry[];
  safetyMode: boolean;
}

export interface FailoverLog {
  id: string;
  timestamp: string;
  fromKey: string;
  toKey: string;
  reason: string;
}

export interface FailoverLogsResponse {
  logs: FailoverLog[];
}

export interface Model {
  id: string;
  modelName: string;
  displayName: string;
  providerId: string;
  provider?: { name: string; displayName: string };
  isActive: boolean;
  pricingInput?: number;
  pricingOutput?: number;
  pricingSource?: string;
}

// ── SWR fetcher ───────────────────────────────

export const fetcher = (url: string) => {
  const token = typeof window !== "undefined" ? localStorage.getItem("auth_token") : null;
  return fetch(`${API_BASE}${url}`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
  }).then(res => {
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  });
};

export interface Provider {
  id: string;
  name: string;
  displayName: string;
}

// ── Auth ───────────────────────────────────────

export const auth = {
  login: (email: string, password: string) =>
    fetchAPI<{ accessToken: string; user: Record<string, unknown> }>(
      "/v1/auth/login",
      { method: "POST", body: JSON.stringify({ email, password }) }
    ),

  register: (email: string, password: string, name: string) =>
    fetchAPI<{ accessToken: string; user: Record<string, unknown> }>(
      "/v1/auth/register",
      { method: "POST", body: JSON.stringify({ email, password, name }) }
    ),
};

// ── Dashboard ──────────────────────────────────

export const dashboard = {
  get: () => fetchAPI<DashboardResponse>("/v1/dashboard"),
};

// ── Agents ─────────────────────────────────────

export const agents = {
  list: () =>
    fetchAPI<{ agents: Agent[]; projects: { projectName: string; agents: Agent[] }[]; total: number }>("/v1/agents"),

  get: (id: string) =>
    fetchAPI<AgentDetailResponse>(`/v1/agents/${id}`),

  getCostTrend: (id: string, range = "7d") =>
    fetchAPI<{ trend: CostPoint[]; total: number }>(
      `/v1/agents/${id}/cost-trend?range=${range}`
    ),

  getCostBreakdown: (id: string, range = "7d") =>
    fetchAPI<CostBreakdownResponse>(
      `/v1/agents/${id}/cost-breakdown?range=${range}`
    ),

  getPermissions: (id: string) =>
    fetchAPI<PermissionsResponse>(`/v1/agents/${id}/permissions`),

  getFailoverLogs: (id: string) =>
    fetchAPI<FailoverLogsResponse>(`/v1/agents/${id}/failover-logs`),

  updatePermissions: (id: string, data: unknown) =>
    fetchAPI(`/v1/agents/${id}/permissions`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
};

// ── Keys ───────────────────────────────────────

export const keys = {
  list: (params?: string) =>
    fetchAPI<{ keys: Key[]; total: number }>(
      `/v1/keys${params ? `?${params}` : ""}`
    ),

  get: (id: string) =>
    fetchAPI<{ key: Key }>(`/v1/keys/${id}`),

  create: (data: unknown) =>
    fetchAPI<{ key: Key }>("/v1/keys", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (id: string, data: unknown) =>
    fetchAPI<{ key: Key }>(`/v1/keys/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  delete: (id: string) =>
    fetchAPI(`/v1/keys/${id}`, { method: "DELETE" }),

  test: (id: string) =>
    fetchAPI<{ status: string; message: string }>(`/v1/keys/${id}/test`, {
      method: "POST",
    }),

  discoverModels: (id: string) =>
    fetchAPI<DiscoverModelsResponse>(`/v1/keys/${id}/discover-models`, {
      method: "POST",
    }),

  getUsage: (id: string, range = "7d") =>
    fetchAPI<KeyUsageResponse>(`/v1/keys/${id}/usage?range=${range}`),
};

// ── Models ─────────────────────────────────────

export const models = {
  list: (providerId?: string) =>
    fetchAPI<{ models: Model[]; total: number }>(
      `/v1/models${providerId ? `?providerId=${providerId}` : ""}`
    ),
};

// ── Providers ──────────────────────────────────

export const providers = {
  list: () => fetchAPI<{ providers: Provider[] }>("/v1/providers"),
};