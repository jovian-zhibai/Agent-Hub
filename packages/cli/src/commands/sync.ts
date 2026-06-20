// ──────────────────────────────────────────────
// Agent Hub CLI — sync 命令
// 从后端拉取 permissions + key bindings 到本地缓存
// ──────────────────────────────────────────────

import { Command } from "commander";
import { ApiClient } from "../utils/api.js";
import {
  readConfig,
  isConnected,
  readCacheFile,
  writeCacheFile,
} from "../utils/config.js";

// ──────────────────────────────────────────────
// Types (local cache format)
// ──────────────────────────────────────────────

interface PermissionsCache {
  version: number;
  rules: Record<string, unknown>;
  safetyMode: boolean;
  syncedAt: number;
  expiresAt: number | null;
}

interface KeyBindingsCache {
  version: number;
  keyPriority: Array<{
    keyId: string;
    provider: string;
    protocol: string;
    status: string;
  }>;
  syncedAt: number;
  expiresAt: number | null;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

// ──────────────────────────────────────────────
// Command definition
// ──────────────────────────────────────────────

export function createSyncCommand(program: Command): void {
  program
    .command("sync")
    .description("从 Agent Hub 同步 permissions 和 key bindings 配置")
    .option("--no-heartbeat", "不启动后台心跳进程")
    .action(handleSync);
}

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────

async function handleSync(options: { heartbeat?: boolean }): Promise<void> {
  try {
    // ── Step 1: Check connection ──────────────
    const connected = await isConnected();
    if (!connected) {
      console.log("❌ 尚未连接到 Agent Hub");
      console.log("   请先运行 `agent-hub connect` 进行连接。");
      process.exit(1);
    }

    const config = await readConfig();
    if (!config.authToken || !config.agentId) {
      console.log("❌ 配置不完整：缺少 authToken 或 agentId");
      console.log("   请重新运行 `agent-hub connect`。");
      process.exit(1);
    }

    // ── Step 2: Sync from backend ─────────────
    console.log("🔄 正在同步配置...");
    const apiClient = new ApiClient(config.apiBaseUrl);
    const syncResult = await apiClient.syncAgent(
      config.authToken,
      config.agentId,
    );
    console.log(`   权限版本: v${syncResult.permissions.version}`);
    console.log(`   Key 绑定数: ${syncResult.keyBindings.length} 条`);
    console.log(`   Agent 状态: ${syncResult.agentStatus}`);

    // ── Step 3: Write permissions cache ────────
    const permissionsCache: PermissionsCache = {
      version: syncResult.permissions.version,
      rules: syncResult.permissions.rules,
      safetyMode: syncResult.permissions.safetyMode,
      syncedAt: Date.now(),
      expiresAt: Date.now() + 3600_000, // 1 hour TTL
    };
    await writeCacheFile("permissions.json", permissionsCache);
    console.log("   ✅ permissions 已缓存");

    // ── Step 4: Write key bindings cache ───────
    const keyBindingsCache: KeyBindingsCache = {
      version: syncResult.keyBindingsVersion,
      keyPriority: syncResult.keyBindings.map((kb) => ({
        keyId: kb.keyId,
        provider: kb.provider,
        protocol: kb.protocol,
        status: kb.status,
      })),
      syncedAt: Date.now(),
      expiresAt: Date.now() + 3600_000, // 1 hour TTL
    };
    await writeCacheFile("key-bindings.json", keyBindingsCache);
    console.log("   ✅ key-bindings 已缓存");

    // ── Step 5: Output ─────────────────────────
    console.log(
      `\n✅ 同步完成：permissions v${syncResult.permissions.version} / key bindings ${syncResult.keyBindings.length} 条`,
    );

    // ── Step 6: Check agent status ──────────────
    if (syncResult.agentStatus === "disabled") {
      console.log("⚠️  此 Agent 已被禁用，心跳将不会启动。");
      console.log("   请到 Agent Hub 面板重新启用。");
      process.exit(1);
    }

    // ── Step 7: Start heartbeat (unless --no-heartbeat) ──
    if (options.heartbeat !== false) {
      startHeartbeat(apiClient, config.authToken, config.agentId);
    }

    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ 同步失败: ${message}`);
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// Heartbeat
// ──────────────────────────────────────────────

/**
 * Start a background heartbeat process.
 * Sends a heartbeat every 30 seconds until the process exits.
 */
function startHeartbeat(
  apiClient: ApiClient,
  token: string,
  agentId: string,
): void {
  console.log(`\n💓 心跳进程已启动（每 30 秒上报一次）`);
  console.log("   按 Ctrl+C 停止\n");

  const interval = setInterval(async () => {
    try {
      const ack = await apiClient.sendHeartbeat(token, {
        agentId,
        timestamp: Date.now(),
      });

      if (ack.status === "disabled") {
        console.log("\n⚠️  Agent 已被禁用，心跳停止。");
        console.log("   请到 Agent Hub 面板重新启用后重新 sync。");
        clearInterval(interval);
        process.exit(1);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`   ❌ 心跳上报失败: ${message}`);
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Clean up on exit
  process.on("SIGINT", () => {
    console.log("\n⏹  心跳进程已停止");
    clearInterval(interval);
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    clearInterval(interval);
    process.exit(0);
  });
}