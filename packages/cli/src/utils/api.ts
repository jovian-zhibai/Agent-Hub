// ──────────────────────────────────────────────
// Agent Hub CLI — API Client
// 与后端 API 的通信层
// ──────────────────────────────────────────────

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface AuthResponse {
  token: string;
  agentId: string;
  agentName: string;
  expiresAt: number;
  agentToken?: string;
}

export interface AgentRegistration {
  id: string;
  name: string;
  type: string;
  machineId: string;
  status: "active" | "disabled";
}

export interface SyncResponse {
  permissions: {
    version: number;
    rules: Record<string, unknown>;
    safetyMode: boolean;
  };
  keyBindings: Array<{
    keyId: string;
    provider: string;
    protocol: string;
    status: "active" | "standby";
  }>;
  keyBindingsVersion: number;
  agentStatus: "active" | "disabled";
}

export interface HeartbeatAck {
  status: "ok" | "disabled";
}

// ──────────────────────────────────────────────
// API Client
// ──────────────────────────────────────────────

export class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    // Strip trailing slash for consistency
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  // ── Auth ─────────────────────────────────────

  /**
   * Login with email and password.
   * Returns an auth token on success.
   */
  async login(email: string, password: string): Promise<AuthResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "agent-hub-cli/1.0",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ApiError(
        `登录失败: ${response.status}`,
        response.status,
        body,
      );
    }

    const data = (await response.json()) as {
      accessToken: string;
      agentToken?: string;
      expiresAt: number;
      user?: { id: string; name: string };
    };
    return {
      token: data.accessToken,
      agentId: data.user?.id ?? "",
      agentName: data.user?.name ?? "",
      expiresAt: data.expiresAt,
      agentToken: data.agentToken,
    };
  }

  /**
   * Register a new account.
   */
  async register(
    email: string,
    password: string,
  ): Promise<AuthResponse> {
    const response = await fetch(`${this.baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "agent-hub-cli/1.0",
      },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ApiError(
        `注册失败: ${response.status}`,
        response.status,
        body,
      );
    }

    const data = (await response.json()) as {
      accessToken: string;
      agentToken?: string;
      expiresAt: number;
      user?: { id: string; name: string };
    };
    return {
      token: data.accessToken,
      agentId: data.user?.id ?? "",
      agentName: data.user?.name ?? "",
      expiresAt: data.expiresAt,
      agentToken: data.agentToken,
    };
  }

  // ── Agent Registration ───────────────────────

  /**
   * Register an agent with the Hub.
   */
  async registerAgent(
    token: string,
    agent: { name: string; type: string; machineId: string; projectName: string; projectPath: string; permissions?: { tool: string; action: string }[] },
  ): Promise<AgentRegistration> {
    const response = await fetch(`${this.baseUrl}/api/v1/agents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "agent-hub-cli/1.0",
      },
      body: JSON.stringify({
        name: agent.name,
        type: agent.type,
        machineId: agent.machineId,
        projectName: agent.projectName,
        projectPath: agent.projectPath,
        permissions: agent.permissions,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ApiError(
        `Agent 注册失败: ${response.status}`,
        response.status,
        body,
      );
    }

    const data = (await response.json()) as AgentRegistration;
    return data;
  }

  // ── Key Registration ─────────────────────────

  /**
   * Register an API key with the Hub.
   */
  async registerKey(
    token: string,
    data: {
      providerId: string;
      protocol: string;
      keyLabel: string;
      keyEncrypted: string;
      scope: string;
    },
  ): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/keys`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "agent-hub-cli/1.0",
        },
        body: JSON.stringify(data),
      });

      if (response.ok) return response.json();

      // 404 = endpoint not found (usually wrong API URL)
      if (response.status === 404) {
        console.warn(`   ⚠️ Key registration failed: 404 — check API URL (${this.baseUrl}/api/v1/keys)`);
        return null;
      }

      // 409 Conflict = Key 已存在，不视为失败
      if (response.status === 409) {
        console.log(`   ⏭️ Key already registered, skipping`);
        return null;
      }

      console.warn(`   ⚠️ Key registration failed: ${response.status}`);
      return null;
    } catch (err) {
      console.warn(`   ⚠️ Key registration error (network/connection): ${err instanceof Error ? err.message : 'unknown'}`);
      return null;
    }
  }

  // ── Sync ─────────────────────────────────────

  /**
   * Sync agent configuration (permissions + key bindings).
   */
  async syncAgent(token: string, agentId: string): Promise<SyncResponse> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/sync/${agentId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "User-Agent": "agent-hub-cli/1.0",
        },
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ApiError(
        `同步失败: ${response.status}`,
        response.status,
        body,
      );
    }

    const data = (await response.json()) as SyncResponse;
    return data;
  }

  // ── Telemetry ────────────────────────────────

  /**
   * Send a heartbeat event via the batch telemetry endpoint.
   */
  async sendHeartbeat(
    token: string,
    payload: { agentId: string; timestamp: number },
  ): Promise<void> {
    const url = `${this.baseUrl}/api/v1/telemetry/batch`;
    const body = JSON.stringify({
      events: [{
        agentId: payload.agentId,
        eventType: "heartbeat",
        payload: {
          status: "running",
          uptime: process.uptime(),
          memoryUsage: process.memoryUsage().heapUsed,
        },
        timestamp: payload.timestamp,
      }],
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "agent-hub-cli/1.0",
        },
        body,
      });
      if (!response.ok) {
        // Non-critical — silently swallow
      }
    } catch {
      // Non-critical — silently swallow
    }
  }
}

// ──────────────────────────────────────────────
// Error Types
// ──────────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public body: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}