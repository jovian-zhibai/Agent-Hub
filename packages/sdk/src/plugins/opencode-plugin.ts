// ──────────────────────────────────────────────
// Agent Hub SDK — OpenCode Plugin
// 插件适配层：注入到 @opencode-ai/plugin 进程，
// 注册 permission.ask / tool.execute.before / event 三个 hook
//
// 经验教训（2026-08-29）：
// - hook 名和字段名必须读 node_modules 里的真实类型/源码枚举，不许照文档猜
// - "llm.completion" hook 不存在；token 用量从 event hook 的 message.updated 事件取
// - 插件函数必须直接返回 Hooks 对象，不能返回 { name, hooks } 包装
// - getSDK() 降级实例必须用 sdkConfig，不能写死空 token（否则 401）
// ──────────────────────────────────────────────

import type { Plugin, Permission } from "@opencode-ai/plugin";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { LocalCache } from "../local-cache";
import { PermissionChecker, type CheckDecision } from "../permission-checker";
import { KeyManager } from "../key-manager";
import { DataReporter } from "../data-reporter";

// ──────────────────────────────────────────────
// 调试开关：AGENT_HUB_DEBUG=1 才输出调试日志
// ──────────────────────────────────────────────
const DEBUG = process.env.AGENT_HUB_DEBUG === "1";

function debugLog(message: string, data?: unknown): void {
  if (!DEBUG) return;
  const line = `[${new Date().toISOString()}] ${message}${data !== undefined ? " " + JSON.stringify(data).slice(0, 300) : ""}`;
  console.log(`[agent-hub] ${line}`);
  try {
    fs.appendFileSync("/tmp/agent-hub-plugin.log", line + "\n");
  } catch {
    // 写文件失败不影响主流程
  }
}

// ──────────────────────────────────────────────
// 项目作用域：只有 opc-agents 项目的会话才上报
// 其他项目完全透明：不上报、不拦工具（fail-open）
// ──────────────────────────────────────────────
function isOpcAgentsProject(cwd?: string): boolean {
  const dir = cwd ?? process.cwd();
  return dir.includes("opc-agents") || dir.includes("opc_agents");
}

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface PluginConfig {
  apiBaseUrl: string;
  authToken: string;
  agentId: string;
}

// 节流：同一工具的降级日志只打第一次，避免刷屏
const degradedLogged = new Set<string>();

// ──────────────────────────────────────────────
// Plugin Hooks Definition
//
// 注意：opencode 插件函数必须直接返回 Hooks 对象（包含 hook 函数），
// 不能返回 { name, description, hooks } 包装——opencode 会从返回对象
// 里直接找 "permission.ask" 等 hook 函数，多一层 hooks 包装会导致
// hook 永远不被触发。
// ──────────────────────────────────────────────

const opencodeHooks = {
  /**
   * dispose — 插件卸载/进程退出时调用
   *
   * 必须停止 DataReporter 的定时器，否则 setInterval 会阻止 Node.js 进程退出
   * （OpenCode 退不出去、Ctrl+C 没反应的根因）。
   * DataReporter 的 timer 也加了 .unref() 作为双重保险。
   */
  dispose: async () => {
    debugLog("dispose: stopping DataReporter");
    try {
      const { reporter } = getSDK();
      await reporter.stop();
    } catch {
      // stop 失败不影响退出
    }
  },

  /**
   * Hook 1：permission.ask — 权限拦截（核心）
   *
   * 在 Agent 每次请求权限时触发。
   * 非 opc-agents 项目：直接返回，不拦截（fail-open）。
   */
  "permission.ask": async (perm: Permission, output: { status: string }) => {
    // 项目作用域：非 opc-agents 项目不拦截
    const cwd = (perm as any)?.cwd ?? (perm as any)?.path?.cwd;
    if (!isOpcAgentsProject(cwd)) {
      debugLog("permission.ask skipped (not opc-agents project)", { cwd });
      return;
    }

    debugLog("permission.ask triggered", { toolName: (perm as any)?.toolName });

    try {
      const { checker, reporter } = await getOrInitSDK();

      const decision: CheckDecision = await checker.check({
        toolType: mapOpenCodeToolType((perm as any)?.toolName ?? ""),
        toolName: (perm as any)?.toolName ?? "",
        toolInput: (perm as any)?.toolInput as Record<string, unknown> | undefined,
        safetyMode: (perm as any)?.safetyMode,
      });

      if (decision === "allow") {
        output.status = "allow";
      } else if (decision === "deny") {
        output.status = "deny";

        reporter
          .reportEvent({
            type: "permission_denied",
            agentId: sdkConfig?.agentId ?? "",
            payload: {
              toolName: (perm as any)?.toolName,
              toolInput: (perm as any)?.toolInput,
              reason: "denied_by_rules",
            },
            timestamp: Date.now(),
          })
          .catch(() => {});
      } else {
        output.status = "ask";
      }
    } catch (err) {
      // 够不到 hub → 降级策略：safety mode 开 → fail-closed；关 → 放行
      const safetyOn = (perm as any)?.safetyMode === true;
      const toolName = (perm as any)?.toolName ?? "unknown";

      if (safetyOn) {
        if (!degradedLogged.has(toolName)) {
          degradedLogged.add(toolName);
          console.warn(`[AgentHub] PERMISSION FAIL-CLOSED: hub unreachable + safetyMode=on, denying tool=${toolName}`);
        }
        output.status = "deny";
      } else {
        if (!degradedLogged.has(toolName)) {
          degradedLogged.add(toolName);
          console.warn(`[AgentHub] PERMISSION DEGRADED: hub unreachable, allowing tool=${toolName} (safetyMode=off)`);
        }
        output.status = "allow";

        try {
          const { reporter } = getSDK();
          reporter
            .reportEvent({
              type: "permission_degraded",
              agentId: sdkConfig?.agentId ?? "",
              payload: {
                toolName,
                toolInput: (perm as any)?.toolInput,
                reason: err instanceof Error ? err.message : String(err),
                safetyMode: safetyOn,
              },
              timestamp: Date.now(),
            })
            .catch(() => {});
        } catch {
          // 事件补传失败不影响降级放行
        }
      }
    }
  },

  /**
   * Hook 2：tool.execute.before — 工具调用上报（旁路不阻断）
   *
   * 非 opc-agents 项目：不上报。
   */
  "tool.execute.before": (input: { tool: string; sessionID: string; callID: string }, output: { args: any }) => {
    // 项目作用域：非 opc-agents 项目不上报
    if (!isOpcAgentsProject()) {
      return;
    }

    debugLog("tool.execute.before triggered", { tool: input.tool, sessionID: input.sessionID });

    try {
      const { reporter } = getSDK();

      reporter
        .reportImmediately({
          type: "tool_call",
          agentId: sdkConfig?.agentId ?? "",
          payload: {
            toolName: input.tool,
            toolInput: output.args,
            sessionId: input.sessionID,
            callID: input.callID,
          },
          timestamp: Date.now(),
        })
        .catch(() => {});
    } catch {
      // 上报失败不阻塞工具执行
    }
  },

  /**
   * Hook 3：event — 通用事件钩子，用于 token_usage 上报
   *
   * "llm.completion" hook 不存在。token 用量从 message.updated 事件的
   * AssistantMessage 里取（properties.info.tokens: { input, output, reasoning, cache }）。
   *
   * 只处理 type === "message.updated" 且 info 有 tokens 字段的事件（AssistantMessage）。
   * 非 opc-agents 项目：不上报。
   */
  event: async ({ event }: { event: any }) => {
    try {
      // 只处理 message.updated 事件
      if (event?.type !== "message.updated") return;

      const info = event?.properties?.info;
      // AssistantMessage 才有 tokens 字段；UserMessage 没有
      if (!info?.tokens) return;

      // 项目作用域：从 AssistantMessage.path.cwd 获取
      const cwd = info?.path?.cwd;
      if (!isOpcAgentsProject(cwd)) {
        return;
      }

      const tokens = info.tokens;
      const totalTokens = (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0);

      // 跳过 0 token 的消息（比如系统消息）
      if (totalTokens === 0) return;

      debugLog("token_usage from message.updated", {
        modelID: info.modelID,
        providerID: info.providerID,
        sessionID: info.sessionID,
        cost: info.cost,
        tokens,
        totalTokens,
      });

      const { reporter } = getSDK();

      reporter
        .reportImmediately({
          type: "token_usage",
          agentId: sdkConfig?.agentId ?? "",
          payload: {
            model: info.modelID ?? "unknown",
            provider: info.providerID ?? "unknown",
            sessionId: info.sessionID,
            messageID: info.id,
            cost: info.cost ?? 0,
            promptTokens: tokens.input ?? 0,
            completionTokens: tokens.output ?? 0,
            reasoningTokens: tokens.reasoning ?? 0,
            cacheReadTokens: tokens.cache?.read ?? 0,
            cacheWriteTokens: tokens.cache?.write ?? 0,
            totalTokens,
          },
          timestamp: Date.now(),
        })
        .catch(() => {});
    } catch {
      // event hook 失败不影响主流程
    }
  },
};

// OpenCode 插件必须导出为函数（可以是 async），调用后返回 Hooks 对象
// 注意：必须直接返回 Hooks 对象（包含 hook 函数），不能返回 { name, hooks } 包装
export default async function agentHubPlugin() {
  return opencodeHooks;
}

// ──────────────────────────────────────────────
// SDK 初始化（惰性、单例）
// ──────────────────────────────────────────────

let sdkInstance: {
  cache: LocalCache;
  checker: PermissionChecker;
  keyManager: KeyManager;
  reporter: DataReporter;
} | null = null;

let sdkConfig: PluginConfig | null = null;
let initPromise: Promise<typeof sdkInstance> | null = null;

// 模块加载时同步读一次 config，消除 agentId/authToken 的初始化竞态
(function loadConfigSync() {
  try {
    const p = path.join(os.homedir(), ".agent-hub", "config.json");
    const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
    // 兼容 CacheEntry 包装（{version, expiresAt, data, createdAt}）与裸对象
    const data = parsed?.data ?? parsed;
    if (data?.agentId) {
      sdkConfig = {
        apiBaseUrl: data.apiBaseUrl ?? "http://localhost:3000",
        authToken: data.authToken ?? "",
        agentId: data.agentId,
      };
    }
  } catch {
    // 静默，交给惰性初始化兜底
  }
})();

async function initSDK(configDir?: string): Promise<{
  cache: LocalCache;
  checker: PermissionChecker;
  keyManager: KeyManager;
  reporter: DataReporter;
}> {
  const baseDir = configDir ?? path.join(os.homedir(), ".agent-hub");
  const cache = new LocalCache(baseDir);
  const checker = new PermissionChecker(cache);
  const keyManager = new KeyManager(cache);

  try {
    const raw = await cache.get<PluginConfig>("config");
    sdkConfig = raw ?? { apiBaseUrl: "http://localhost:3000", authToken: "", agentId: "" };
  } catch {
    sdkConfig = { apiBaseUrl: "http://localhost:3000", authToken: "", agentId: "" };
  }

  const reporter = new DataReporter({
    apiBaseUrl: sdkConfig.apiBaseUrl,
    authToken: sdkConfig.authToken,
    agentId: sdkConfig.agentId,
  });

  try {
    await reporter.start();
  } catch {
    console.warn("[AgentHub] DataReporter start failed, telemetry will not be sent");
  }

  return { cache, checker, keyManager, reporter };
}

async function getOrInitSDK(): Promise<{
  cache: LocalCache;
  checker: PermissionChecker;
  keyManager: KeyManager;
  reporter: DataReporter;
}> {
  if (sdkInstance) return sdkInstance;

  if (!initPromise) {
    initPromise = initSDK()
      .then((instance) => {
        sdkInstance = instance;
        return instance;
      })
      .catch((err) => {
        console.warn(`[AgentHub] SDK init failed, using degraded mode: ${err instanceof Error ? err.message : String(err)}`);
        const cache = new LocalCache();
        const config = sdkConfig ?? { apiBaseUrl: "http://localhost:3000", authToken: "", agentId: "" };
        const instance = {
          cache,
          checker: new PermissionChecker(cache),
          keyManager: new KeyManager(cache),
          reporter: new DataReporter(config),
        };
        sdkInstance = instance;
        return instance;
      });
  }

  return initPromise;
}

/**
 * 同步获取已初始化的 SDK 实例（不等待初始化）。
 * 如果尚未初始化，返回一个临时降级实例（用 sdkConfig，不写死空值）。
 * 用于 tool.execute.before 和 event 这些旁路 hook。
 */
function getSDK(): {
  cache: LocalCache;
  checker: PermissionChecker;
  keyManager: KeyManager;
  reporter: DataReporter;
} {
  if (sdkInstance) return sdkInstance;

  const cache = new LocalCache();
  const config = sdkConfig ?? {
    apiBaseUrl: "http://localhost:3000",
    authToken: "",
    agentId: "",
  };
  return {
    cache,
    checker: new PermissionChecker(cache),
    keyManager: new KeyManager(cache),
    reporter: new DataReporter(config),
  };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function mapOpenCodeToolType(toolName: string): string {
  const map: Record<string, string> = {
    Read: "read",
    Bash: "bash",
    Edit: "edit",
    Write: "write",
    WebFetch: "webfetch",
    Fetch: "webfetch",
    Execute: "bash",
  };
  return map[toolName] ?? toolName.toLowerCase();
}
