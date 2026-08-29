// ──────────────────────────────────────────────
// Agent Hub SDK — Pi Extension
// Pi 运行时适配层：注册 before_agent_start / tool_call / message_end 三个 hook，
// 上报会话事件 / 工具调用 / Token 用量到 Agent Hub。
//
// 安装：构建后把 dist/plugins/pi-extension.js 复制到 ~/.pi/agent/extensions/
// ──────────────────────────────────────────────

import * as path from "node:path";
import * as os from "node:os";
import { DataReporter } from "../data-reporter";

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
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const raw = require("fs").readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as HubConfig;
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
    // 启动失败不影响 Pi 运行
    console.warn("[AgentHub] Pi extension: DataReporter start failed, telemetry will not be sent");
  });

  return reporter;
}

// ──────────────────────────────────────────────
// Pi Extension Default Export
// ──────────────────────────────────────────────

/**
 * Pi extension 入口函数。
 * Pi 加载 extension 时调用默认导出，传入 pi 对象，通过 pi.on() 注册 hook。
 *
 * Hook 参考（pi.dev/docs/latest/extensions）：
 * - before_agent_start: Agent 启动前，可注入 message / 修改 system prompt
 * - tool_call: 工具调用前，event.toolName / event.input，可 return { block: true }
 * - message_end: 消息结束（token 用量字段名待实测，先打印 payload 确认）
 */
export default function (pi: any) {
  // ── Hook 1: before_agent_start → heartbeat/session_start ──
  pi.on("before_agent_start", async (event: any, _ctx: any) => {
    try {
      const r = getReporter();
      if (!r) return;

      r.reportImmediately({
        type: "heartbeat",
        agentId: agentId || "pi-director",
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

  // ── Hook 2: tool_call → tool_call 事件 ──
  pi.on("tool_call", async (event: any, _ctx: any) => {
    try {
      const r = getReporter();
      if (!r) return;

      r.reportImmediately({
        type: "tool_call",
        agentId: agentId || "pi-director",
        payload: {
          runtime: "pi",
          toolName: event?.toolName,
          toolInput: event?.input,
        },
        timestamp: Date.now(),
      }).catch(() => {});
    } catch {
      // 上报失败不阻断工具执行
    }
    // 不拦截（不 return { block: true }），只做旁路上报
  });

  // ── Hook 3: message_end → token_usage 事件 ──
  // 注意：token 用量字段名待实测。首次运行时先 console.log 打印完整 payload，
  // 确认字段路径后再精确提取。当前用常见路径做 best-effort 提取。
  pi.on("message_end", async (event: any) => {
    try {
      const r = getReporter();
      if (!r) return;

      // best-effort 提取 token 用量（字段名待实测确认）
      const usage = event?.usage || event?.tokenUsage || event?.tokens || {};
      const promptTokens = usage?.promptTokens ?? usage?.input ?? 0;
      const completionTokens = usage?.completionTokens ?? usage?.output ?? 0;

      r.reportImmediately({
        type: "token_usage",
        agentId: agentId || "pi-director",
        payload: {
          runtime: "pi",
          model: event?.model || "unknown",
          promptTokens,
          completionTokens,
          totalTokens: promptTokens + completionTokens,
          // 保留原始 payload 片段，方便后续确认字段名
          _rawKeys: Object.keys(event || {}).slice(0, 20),
        },
        timestamp: Date.now(),
      }).catch(() => {});
    } catch {
      // 上报失败不影响
    }
  });
}
