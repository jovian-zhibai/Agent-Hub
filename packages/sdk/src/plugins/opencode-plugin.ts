// ──────────────────────────────────────────────
// Agent Hub SDK — OpenCode Plugin
// 插件适配层：注入到 @opencode-ai/plugin 进程，
// 自动注册 permission.ask / tool.execute.before / llm.completion 三个 hook
// ──────────────────────────────────────────────

import type { Plugin, Permission, ToolExecuteInput } from "@opencode-ai/plugin";
import * as path from "node:path";
import * as os from "node:os";
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
     * 5. SDK 异常/超时 → 默认 deny（安全优先）
     */
    "permission.ask": async (perm: Permission, output: { status: string }) => {
      try {
        const { checker, reporter } = await getOrInitSDK();

        const decision: CheckDecision = await checker.check({
          toolType: mapOpenCodeToolType(perm.toolName ?? ""),
          toolName: perm.toolName ?? "",
          toolInput: perm.toolInput as Record<string, unknown> | undefined,
          safetyMode: perm.safetyMode,
        });

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
        // SDK 崩溃 → 默认 deny（安全优先）
        console.warn(
          `[AgentHub] Permission check failed, defaulting to deny: ${err instanceof Error ? err.message : String(err)}`,
        );
        output.status = "deny";
      }
    },

    /**
     * Hook 2：tool.execute.before — 工具调用上报（旁路不阻断）
     *
     * 在 Agent 执行工具调用前触发。
     * 异步上报工具调用事件，不 await，不阻塞主流程。
     */
    "tool.execute.before": (_input: ToolExecuteInput, _output: Record<string, unknown>) => {
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

export default opencodePlugin;

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
