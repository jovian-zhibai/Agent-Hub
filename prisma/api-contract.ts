// ──────────────────────────────────────────────
// Agent Hub — API Contract
// Shared type definitions between backend and SDK
// ──────────────────────────────────────────────

// ==============================================
// Base Configuration
// ==============================================

export const API = {
  baseUrl: process.env.AGENT_HUB_API_URL || "http://localhost:3000",
  version: "v1",
} as const;

export type ApiVersion = typeof API.version;

// ==============================================
// Common Types
// ==============================================

/** Standard paginated response wrapper */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/** Standard error response */
export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/** Standard success envelope */
export interface ApiResponse<T> {
  data: T;
}

// ==============================================
// Auth Endpoints
// ==============================================

// POST /v1/auth/register
export interface RegisterRequest {
  email: string;
  password: string;
}
export interface RegisterResponse {
  token: string;
  user: AccountResponse;
}

// POST /v1/auth/login
export interface LoginRequest {
  email: string;
  password: string;
}
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
}

// POST /v1/auth/refresh
export interface RefreshRequest {
  refreshToken: string;
}
export interface RefreshResponse {
  accessToken: string;
}

// ==============================================
// Account Response
// ==============================================

export interface AccountResponse {
  id: string;
  name: string;
  email: string;
  plan: string;
  createdAt: string;
}

// ==============================================
// Agent Endpoints
// ==============================================

export type AgentStatus =
  | "running"
  | "idle"
  | "disabled"
  | "offline"
  | "error";

/** GET /v1/agents */
export interface ListAgentsRequest {
  page?: number;
  limit?: number;
}
export type ListAgentsResponse = PaginatedResponse<AgentResponse>;

/** GET /v1/agents/:id */
export type GetAgentResponse = AgentResponse;

/** PATCH /v1/agents/:id */
export interface UpdateAgentRequest {
  name?: string;
  status?: AgentStatus;
  safetyMode?: boolean;
  monthlyBudget?: number;
}
export type UpdateAgentResponse = AgentResponse;

/** PATCH /v1/agents/:id/enable */
export type EnableAgentResponse = AgentResponse;

/** PATCH /v1/agents/:id/disable */
export type DisableAgentResponse = AgentResponse;

export interface AgentResponse {
  id: string;
  accountId: string;
  name: string;
  description: string | null;
  framework: string;
  status: AgentStatus;
  machineId: string | null;
  safetyMode: boolean;
  monthlyBudget: number | null;
  monthlySpent: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// ==============================================
// Permission Endpoints
// ==============================================

/** GET /v1/agents/:id/permissions */
export type GetPermissionResponse = PermissionResponse;

/** PATCH /v1/agents/:id/permissions */
export interface UpdatePermissionRequest {
  rules?: Record<string, unknown>;
  safetyMode?: boolean;
}
export type UpdatePermissionResponse = PermissionResponse;

export interface PermissionResponse {
  id: string;
  agentId: string;
  rules: Record<string, unknown>;
  safetyMode: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

// ==============================================
// Key Endpoints
// ==============================================

export type KeyHealth =
  | "normal"
  | "warning"
  | "critical"
  | "rate_limited"
  | "invalid"
  | "stale";

export type KeyScope = "personal" | "workspace";

/** GET /v1/keys */
export interface ListKeysRequest {
  provider?: string;
  health?: KeyHealth;
}
export type ListKeysResponse = KeyResponse[];

/** POST /v1/keys */
export interface CreateKeyRequest {
  providerId: string;
  protocol?: string;
  keyLabel: string;
  keyEncrypted: string;
  scope: KeyScope;
  group?: string;
  note?: string;
  initialBalance?: number;
}
export type CreateKeyResponse = KeyResponse;

/** PATCH /v1/keys/:id */
export interface UpdateKeyRequest {
  keyLabel?: string;
  note?: string;
  initialBalance?: number;
}
export type UpdateKeyResponse = KeyResponse;

/** DELETE /v1/keys/:id */
export type DeleteKeyResponse = void;

/** POST /v1/keys/:id/test */
export interface TestKeyResponse {
  health: "connected" | "failed";
  message?: string;
}

/** POST /v1/keys/:id/discover-models */
export interface DiscoverModelsRequest {
  keyId: string;
}
export interface DiscoverModelsResponse {
  models: ModelResponse[];
  matched: number;
  unmatched: number;
}

export interface KeyResponse {
  id: string;
  provider: { id: string; name: string };
  protocol: string;
  keyLabel: string;
  keyPrefix: string | null;
  scope: KeyScope;
  group: string | null;
  note: string | null;
  health: KeyHealth;
  initialBalance: number | null;
  remaining: number | null;
  burnRate: number | null;
  lastTestedAt: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ==============================================
// Key Binding Endpoints
// ==============================================

/** GET /v1/agents/:id/key-bindings */
export type ListKeyBindingsResponse = KeyBindingResponse[];

/** PUT /v1/agents/:id/key-bindings */
export interface UpdateKeyBindingsRequest {
  bindings: { keyId: string; priority: number }[];
}
export type UpdateKeyBindingsResponse = KeyBindingResponse[];

export interface KeyBindingResponse {
  id: string;
  agentId: string;
  keyId: string;
  priority: number;
  status: string;
  createdAt: string;
  key?: {
    id: string;
    keyLabel: string;
    keyPrefix: string | null;
    provider: { id: string; name: string };
    protocol: string;
    health: KeyHealth;
  };
}

// ==============================================
// Telemetry Endpoints
// ==============================================

/** POST /v1/telemetry/batch */
export interface TelemetryEvent {
  agentId: string;
  keyId?: string;
  eventType: string;
  payload: Record<string, unknown>;
  reportedAt: string;
}
export interface BatchTelemetryRequest {
  events: TelemetryEvent[];
}
export interface BatchTelemetryResponse {
  ingested: number;
}

/** GET /v1/telemetry/agents/:id/summary */
export interface AgentTelemetrySummaryResponse {
  todayCalls: number;
  monthlyCost: number;
  avgCost: number;
  successRate: number;
}

// ==============================================
// Failover Log Endpoints
// ==============================================

/** GET /v1/agents/:id/failover-logs */
export interface ListFailoverLogsRequest {
  page?: number;
  limit?: number;
}
export type ListFailoverLogsResponse = PaginatedResponse<FailoverLogResponse>;

export interface FailoverLogResponse {
  id: string;
  agentId: string;
  fromKeyId: string;
  toKeyId: string;
  reason: string;
  triggeredAt: string;
  fromKey?: {
    id: string;
    keyLabel: string;
    keyPrefix: string | null;
  };
  toKey?: {
    id: string;
    keyLabel: string;
    keyPrefix: string | null;
  };
}

// ==============================================
// Model / Pricing Endpoints
// ==============================================

/** GET /v1/models */
export interface ListModelsRequest {
  providerId?: string;
}
export type ListModelsResponse = ModelResponse[];

export interface ModelResponse {
  id: string;
  providerId: string;
  provider?: ProviderSummary;
  defaultProtocol: string;
  supportedProtocols: string[];
  modelName: string;
  displayName: string;
  pricingInput: number;
  pricingOutput: number;
  pricingAsOf: string | null;
  pricingSource: string;
  isActive: boolean;
  createdAt: string;
}

/** GET /v1/providers */
export type ListProvidersResponse = ProviderResponse[];

/** GET /v1/pricing/sync */
export interface PricingSyncResponse {
  synced: number;
  updated: number;
  errors: string[];
}

export interface ProviderSummary {
  id: string;
  name: string;
  displayName: string;
}

export interface ProviderResponse {
  id: string;
  name: string;
  displayName: string;
  supportedProtocols: string[];
  baseUrls: Record<string, string>;
  createdAt: string;
}

// ==============================================
// Audit Log Endpoints
// ==============================================

/** GET /v1/audit-logs */
export interface ListAuditLogsRequest {
  page?: number;
  limit?: number;
  action?: string;
}
export type ListAuditLogsResponse = PaginatedResponse<AuditLogResponse>;

export interface AuditLogResponse {
  id: string;
  accountId: string;
  operatorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}

// ==============================================
// API Route Map
// ==============================================

/** All API routes with method and path template */
export const ROUTES = {
  auth: {
    register: { method: "POST", path: "/auth/register" } as const,
    login: { method: "POST", path: "/auth/login" } as const,
    refresh: { method: "POST", path: "/auth/refresh" } as const,
  },
  agents: {
    list: { method: "GET", path: "/agents" } as const,
    get: { method: "GET", path: "/agents/:id" } as const,
    update: { method: "PATCH", path: "/agents/:id" } as const,
    enable: { method: "PATCH", path: "/agents/:id/enable" } as const,
    disable: { method: "PATCH", path: "/agents/:id/disable" } as const,
  },
  permissions: {
    get: { method: "GET", path: "/agents/:id/permissions" } as const,
    update: { method: "PATCH", path: "/agents/:id/permissions" } as const,
  },
  keys: {
    list: { method: "GET", path: "/keys" } as const,
    create: { method: "POST", path: "/keys" } as const,
    update: { method: "PATCH", path: "/keys/:id" } as const,
    delete: { method: "DELETE", path: "/keys/:id" } as const,
    test: { method: "POST", path: "/keys/:id/test" } as const,
    discoverModels: {
      method: "POST",
      path: "/keys/:id/discover-models",
    } as const,
  },
  keyBindings: {
    list: { method: "GET", path: "/agents/:id/key-bindings" } as const,
    update: { method: "PUT", path: "/agents/:id/key-bindings" } as const,
  },
  telemetry: {
    batch: { method: "POST", path: "/telemetry/batch" } as const,
    summary: {
      method: "GET",
      path: "/telemetry/agents/:id/summary",
    } as const,
  },
  failoverLogs: {
    list: { method: "GET", path: "/agents/:id/failover-logs" } as const,
  },
  models: {
    list: { method: "GET", path: "/models" } as const,
  },
  providers: {
    list: { method: "GET", path: "/providers" } as const,
  },
  pricing: {
    sync: { method: "GET", path: "/pricing/sync" } as const,
  },
  auditLogs: {
    list: { method: "GET", path: "/audit-logs" } as const,
  },
} as const;

export type RouteMap = typeof ROUTES;