// ──────────────────────────────────────────────
// Agent Hub SDK — Pi Extension
// Pi 运行时适配层：注册 before_agent_start / tool_execution_start / message_end 三个 hook，
// 上报会话事件 / 工具调用 / Token 用量到 Agent Hub。
//
// 经验教训（2026-08-29）：
// - hook 名必须读 node_modules 里的真实类型定义，不许照文档猜
// - 真实事件名：before_agent_start / tool_execution_start / message_end
//   （不是 tool_call；ToolCallEvent 是工具结果的联合类型）
// - token 用量从 message_end 事件的 message.usage 取（字段名待实测确认）
// - config 读取要兼容 CacheEntry 包装（{version, expiresAt, data, createdAt}）
//
// 安装：构建后软链 dist/plugins/pi-extension.js 到 ~/.pi/agent/extensions/
// ──────────────────────────────────────────────

import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { DataReporter } from "../data-reporter";

// ──────────────────────────────────────────────
// 调试开关：AGENT_HUB_DEBUG=1 才输出调试日志
// ──────────────────────────────────────────────
const DEBUG = process.env.AGENT_HUB_DEBUG === "1";

function debugLog(message: string, data?: unknown): void {
  if (!DEBUG) return;
  const line = `[${new Date().toISOString()}] [pi] ${message}${data !== undefined ? " " + JSON.stringify(data).slice(0, 400) : ""}`;
  console.log(`[agent-hub] ${line}`);
  try {
    fs.appendFileSync("/tmp/agent-hub-plugin.log", line + "\n");
  } catch {
    // 写文件失败不影响主流程
  }
}

// ──────────────────────────────────────────────
// 项目作用域：只有 opc-agents 项目的会话才上报
// ──────────────────────────────────────────────
function isOpcAgentsProject(cwd?: string): boolean {
  const dir = cwd ?? process.cwd();
  return dir.includes("opc-agents") || dir.includes("opc_agents");
}

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────

const CONFIG_PATH = path.join(os.homedir(), ".agent-hub", "config.json");

interface HubConfig {
  apiBaseUrl: string;
  authToken: string;
  agentId: string;
}

// ──────────────────────────────────────────────
// State (lazy singleton)
// ──────────────────────────────────────────────

let reporter: DataReporter | null = null;
let agentId: string | null = null;
let initFailed = false;

function loadConfig(): HubConfig | null {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    // 兼容 CacheEntry 包装（{version, expiresAt, data, createdAt}）与裸对象
    const data = parsed?.data ?? parsed;
    if (data?.agentId) {
      return {
        apiBaseUrl: data.apiBaseUrl ?? "http://localhost:3000",
        authToken: data.authToken ?? "",
        agentId: data.agentId,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function getReporter(): DataReporter | null {
  if (reporter) return reporter;
  if (initFailed) return null;

  const config = loadConfig();
  if (!config) {
    initFailed = true;
    console.warn("[AgentHub] Pi extension: config not found, telemetry disabled");
    return null;
  }

  agentId = config.agentId;
  reporter = new DataReporter({
    apiBaseUrl: config.apiBaseUrl,
    authToken: config.authToken,
    agentId: config.agentId,
  });

  reporter.start().catch(() => {
    console.warn("[AgentHub] Pi extension: DataReporter start failed, telemetry will not be sent");
  });

  return reporter;
}

// ──────────────────────────────────────────────
// Pi Extension Default Export
//
// 真实事件名（从 @earendil-works/pi-coding-agent 的 types.d.ts 确认）：
// - before_agent_start: BeforeAgentStartEvent，Agent 开始前
// - tool_execution_start: ToolExecutionStartEvent { toolCallId, toolName, args }
// - message_end: MessageEndEvent { message: AgentMessage }
//
// 注意：ToolCallEvent 是工具结果的联合类型（BashToolCallEvent 等），
// 不是事件名；工具执行开始的事件名是 tool_execution_start。
// ──────────────────────────────────────────────

export default function (pi: any) {
  // ── Hook 1: before_agent_start → heartbeat/session_start ──
  pi.on("before_agent_start", async (event: any, ctx: any) => {
    try {
      // 项目作用域：非 opc-agents 项目不上报
      const cwd = ctx?.cwd ?? event?.cwd;
      if (!isOpcAgentsProject(cwd)) {
        debugLog("before_agent_start skipped (not opc-agents project)", { cwd });
        return;
      }

      const r = getReporter();
      if (!r) return;

      debugLog("before_agent_start triggered", { prompt: event?.prompt?.slice(0, 100) });

      r.reportImmediately({
        type: "heartbeat",
        agentId: agentId || "",
        payload: {
          event: "session_start",
          runtime: "pi",
          prompt: event?.prompt?.slice(0, 200),
        },
        timestamp: Date.now(),
      }).catch(() => {});
    } catch {
      // 上报失败不影响 Pi 运行
    }
    // 不返回 message（不注入上下文，那是 opc-session-hook 的事）
  });

  // ── Hook 2: tool_execution_start → tool_call 事件 ──
  pi.on("tool_execution_start", async (event: any, _ctx: any) => {
    try {
      // 项目作用域
      if (!isOpcAgentsProject()) {
        return;
      }

      const r = getReporter();
      if (!r) return;

      debugLog("tool_execution_start triggered", {
        toolName: event?.toolName,
        toolCallId: event?.toolCallId,
        argsKeys: event?.args ? Object.keys(event.args) : [],
      });

      r.reportImmediately({
        type: "tool_call",
        agentId: agentId || "",
        payload: {
          runtime: "pi",
          toolName: event?.toolName,
          toolInput: event?.args,
          toolCallId: event?.toolCallId,
        },
        timestamp: Date.now(),
      }).catch(() => {});
    } catch {
      // 上报失败不阻断工具执行
    }
    // 不拦截，只做旁路上报
  });

  // ── Hook 3: message_end → token_usage 事件 ──
  // 已确认字段路径（2026-08-29 实测）：
  // event.message.usage = { input, output, cacheRead, cacheWrite, reasoning, totalTokens, cost }
  // event.message.role = "user" | "assistant" | "toolResult"
  // 只上报 assistant 消息且 totalTokens > 0，跳过 user/toolResult 消息。
  pi.on("message_end", async (event: any) => {
    try {
      // 项目作用域
      if (!isOpcAgentsProject()) {
        return;
      }

      const r = getReporter();
      if (!r) return;

      const msg = event?.message ?? {};

      // 只上报 assistant 消息（跳过 user/toolResult/system）
      if (msg?.role !== "assistant") {
        return;
      }

      // 用已确认的字段路径提取 token 用量
      const usage = msg?.usage || {};
      const promptTokens = usage?.input ?? 0;
      const completionTokens = usage?.output ?? 0;
      const totalTokens = usage?.totalTokens ?? (promptTokens + completionTokens);

      // 跳过 0 token 的 assistant 消息（异常情况）
      if (totalTokens === 0) {
        return;
      }

      debugLog("message_end token_usage", {
        model: msg?.model,
        promptTokens,
        completionTokens,
        totalTokens,
        cacheRead: usage?.cacheRead,
        cacheWrite: usage?.cacheWrite,
        reasoning: usage?.reasoning,
      });

      r.reportImmediately({
        type: "token_usage",
        agentId: agentId || "",
        payload: {
          runtime: "pi",
          model: msg?.model || "unknown",
          messageId: msg?.id,
          promptTokens,
          completionTokens,
          totalTokens,
          cacheRead: usage?.cacheRead ?? 0,
          cacheWrite: usage?.cacheWrite ?? 0,
          reasoningTokens: usage?.reasoning ?? 0,
        },
        timestamp: Date.now(),
      }).catch(() => {});
    } catch {
      // 上报失败不影响
    }
  });

  // ── 退出时停止 DataReporter（防止定时器阻止进程退出）──
  // DataReporter 的 timer 已加 .unref()，这里再显式 stop 作为双重保险。
  const stopOnExit = () => {
    try {
      if (reporter) {
        reporter.stop().catch(() => {});
      }
    } catch {
      // ignore
    }
  };
  process.on("beforeExit", stopOnExit);
  process.on("SIGINT", () => { stopOnExit(); process.exit(0); });
  process.on("SIGTERM", () => { stopOnExit(); process.exit(0); });
}
