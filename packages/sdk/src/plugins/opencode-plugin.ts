// ──────────────────────────────────────────────
// Agent Hub SDK — OpenCode Plugin
// 插件适配层：注入到 @opencode-ai/plugin 进程，
// 自动注册 permission.ask / tool.execute.before / llm.completion 三个 hook
// ──────────────────────────────────────────────

import type { Plugin, Permission, ToolExecuteInput } from "@opencode-ai/plugin";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { LocalCache } from "../local-cache";
import { PermissionChecker, type CheckDecision } from "../permission-checker";
import { KeyManager } from "../key-manager";
import { DataReporter } from "../data-reporter";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface PluginConfig {
  apiBaseUrl: string;
  authToken: string;
  agentId: string;
}

// 节流：同一工具的降级日志只打第一次，避免刷屏
// （PermissionChecker.check() 是纯本地规则匹配，"够不到 hub"只在冷初始化触发，
//  所以这个 Set 基本不会增长，但留着防极端情况）
const degradedLogged = new Set<string>();

// ──────────────────────────────────────────────
// Plugin Definition
// ──────────────────────────────────────────────

const opencodePlugin: Plugin = {
  name: "agent-hub",
  description: "Agent Hub 安全护栏 — 权限检查、工具调用上报、Token 用量追踪",

  hooks: {
    /**
     * Hook 1：permission.ask — 权限拦截（核心）
     *
     * 在 Agent 每次请求权限时触发。
     * 1. 初始化 SDK（LocalCache + PermissionChecker）
     * 2. 调 PermissionChecker.check() 做本地规则匹配
     * 3. 根据决策结果设置 output.status
     * 4. 若被拒绝，上报 TelemetryEvent
     * 5. SDK 异常/超时 → 降级策略（三条）：
     *    a. 只在"够不到 hub"时放行；hub 明确返回 deny 必须照办
     *    b. safety mode 开启时 fail-closed
     *    c. 每次降级放行大声记 stderr 日志 + 顺手 enqueue permission_degraded 事件（可能丢）
     */
    "permission.ask": async (perm: Permission, output: { status: string }) => {
      console.log("[agent-hub] hook triggered: permission.ask", perm.toolName);
      try {
        const { checker, reporter } = await getOrInitSDK();

        const decision: CheckDecision = await checker.check({
          toolType: mapOpenCodeToolType(perm.toolName ?? ""),
          toolName: perm.toolName ?? "",
          toolInput: perm.toolInput as Record<string, unknown> | undefined,
          safetyMode: perm.safetyMode,
        });

        // hub 明确返回的决策，照办
        if (decision === "allow") {
          output.status = "allow";
        } else if (decision === "deny") {
          output.status = "deny";

          // 上报权限拒绝事件（fire-and-forget，不阻塞主流程）
          reporter
            .reportEvent({
              type: "permission_denied",
              agentId: sdkConfig?.agentId ?? "",
              payload: {
                toolName: perm.toolName,
                toolInput: perm.toolInput,
                reason: "denied_by_rules",
              },
              timestamp: Date.now(),
            })
            .catch(() => {});
        } else {
          // "ask" — 保持默认，让 OpenCode 弹窗询问用户
          output.status = "ask";
        }
      } catch (err) {
        // 够不到 hub（SDK 初始化失败 / checker 超时 / 缓存不可读）
        // 降级策略：safety mode 开 → fail-closed；关 → 放行 + 大声日志 + 事件补传
        const safetyOn = perm.safetyMode === true;
        const toolName = perm.toolName ?? "unknown";

        if (safetyOn) {
          // safety mode 开启 → fail-closed（不能偷偷放行）
          if (!degradedLogged.has(toolName)) {
            degradedLogged.add(toolName);
            console.warn(
              `[AgentHub] PERMISSION FAIL-CLOSED: hub unreachable + safetyMode=on, denying tool=${toolName}`,
            );
          }
          output.status = "deny";
        } else {
          // safety mode 关闭 → 降级放行
          if (!degradedLogged.has(toolName)) {
            degradedLogged.add(toolName);
            console.warn(
              `[AgentHub] PERMISSION DEGRADED: hub unreachable, allowing tool=${toolName} (safetyMode=off)`,
            );
          }
          output.status = "allow";

          // 顺手 enqueue permission_degraded 事件，靠 DataReporter 批量窗口在 hub 恢复后补传（可能丢）
          try {
            const { reporter } = getSDK();
            reporter
              .reportEvent({
                type: "permission_degraded",
                agentId: sdkConfig?.agentId ?? "",
                payload: {
                  toolName,
                  toolInput: perm.toolInput,
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
     * 在 Agent 执行工具调用前触发。
     * 异步上报工具调用事件，不 await，不阻塞主流程。
     */
    "tool.execute.before": (_input: ToolExecuteInput, _output: Record<string, unknown>) => {
      console.log("[agent-hub] hook triggered: tool.execute.before", _input.toolName);
      try {
        const { reporter } = getSDK();

        // 即时上报，不等待批量窗口
        reporter
          .reportImmediately({
            type: "tool_call",
            agentId: sdkConfig?.agentId ?? "",
            payload: {
              toolName: _input.toolName,
              toolInput: _input.toolInput,
              sessionId: _input.sessionId,
              conversationId: _input.conversationId,
            },
            timestamp: Date.now(),
          })
          .catch(() => {});
      } catch {
        // 上报失败不阻塞工具执行
      }
    },

    /**
     * Hook 3：llm.completion — Token 用量上报
     *
     * 在 LLM 完成一次生成后触发。
     * 即时上报 Token 用量，不等待批量窗口。
     */
    "llm.completion": (
      _input: { prompt: string; promptTokens?: number; completionTokens?: number; model?: string },
      _output: { completion: string },
    ) => {
      console.log("[agent-hub] hook triggered: llm.completion", _input.model, "tokens:", (_input.promptTokens ?? 0) + (_input.completionTokens ?? 0));
      try {
        const { reporter } = getSDK();
        const promptTokens = _input.promptTokens ?? 0;
        const completionTokens = _input.completionTokens ?? 0;

        // 即时上报，不等待批量窗口
        reporter
          .reportImmediately({
            type: "token_usage",
            agentId: sdkConfig?.agentId ?? "",
            payload: {
              model: _input.model ?? "unknown",
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
            },
            timestamp: Date.now(),
          })
          .catch(() => {});
      } catch {
        // 上报失败不阻塞
      }
    },
  },
};

// OpenCode 插件必须导出为函数（可以是 async），调用后返回插件对象
// 参考 ~/.config/opencode/plugins/herdr-agent-state.js 的格式
// 直接导出对象会报 "Plugin export is not a function"
export default async function agentHubPlugin() {
  return opencodePlugin;
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
// （permission.ask 是 async，第一条 tool.execute.before 可能在 initSDK 完成前触发，
//  导致 payload agentId=""、reporter authToken="" → 外键失败 + 401）
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

/**
 * 惰性初始化 SDK 各模块。
 * 缓存结果，多次调用返回同一实例。
 * 初始化失败不抛异常，返回一个降级实例（所有检查默认放行）。
 */
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

  // 尝试加载配置
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

  // 启动 Reporter（后台心跳 + 定时 flush）
  try {
    await reporter.start();
  } catch {
    // 启动失败不影响主流程
    console.warn("[AgentHub] DataReporter start failed, telemetry will not be sent");
  }

  return { cache, checker, keyManager, reporter };
}

/**
 * 获取或初始化 SDK（惰性单例）。
 * 如果初始化中，等待初始化完成。
 */
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
        console.warn(
          `[AgentHub] SDK init failed, using degraded mode: ${err instanceof Error ? err.message : String(err)}`,
        );
        // 降级：创建空实例，所有检查放行
        const cache = new LocalCache();
        const instance = {
          cache,
          checker: new PermissionChecker(cache),
          keyManager: new KeyManager(cache),
          reporter: new DataReporter({
            apiBaseUrl: "http://localhost:3000",
            authToken: "",
            agentId: "",
          }),
        };
        sdkInstance = instance;
        return instance;
      });
  }

  return initPromise;
}

/**
 * 同步获取已初始化的 SDK 实例（不等待初始化）。
 * 如果尚未初始化，返回一个临时降级实例。
 * 用于 tool.execute.before 和 llm.completion 这些旁路 hook。
 */
function getSDK(): {
  cache: LocalCache;
  checker: PermissionChecker;
  keyManager: KeyManager;
  reporter: DataReporter;
} {
  if (sdkInstance) return sdkInstance;

  // 临时降级实例
  const cache = new LocalCache();
  return {
    cache,
    checker: new PermissionChecker(cache),
    keyManager: new KeyManager(cache),
    reporter: new DataReporter({
      apiBaseUrl: "http://localhost:3000",
      authToken: "",
      agentId: "",
    }),
  };
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * 将 OpenCode 工具名映射到 Agent Hub 的工具类型。
 * OpenCode 的工具名是 PascalCase（如 "Read", "Bash", "Edit"），
 * 需要映射到 checker 使用的 snake_case（如 "read", "bash", "edit"）。
 */
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
