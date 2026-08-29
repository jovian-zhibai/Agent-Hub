# Agent Hub 阶段 0 · 接线设计文档

- **版本**: v1.0（待评审）
- **日期**: 2026-08-29
- **状态**: DRAFT — 供评审，未开始实现
- **前置**: `docs/specs/2026-08-28-agent-hub-workbench-design.md`（工作台总设计）

---

## 0. 文档目的

定义阶段 0「接线」的完整方案：把 OPC-Agents 的运行时数据（工具调用、Token 用量、会话事件）通过遥测管道接进 Agent-Hub，让 Dashboard 从空壳变成有真实数据的观测台。

**阶段 0 只做接线，不碰 UI、不做任务/审批/员工档案等工作台功能。** 那些是阶段 1-3 的事。

---

## 1. 目标与验收标准

### 1.1 目标

1. 构建 SDK/CLI，修复两个已知坑（tsup entry 不含 plugin、permission 默认 deny 会阻断 OPC-Agents）
2. 接入 OpenCode 插件（现成，修坑后可用）
3. 接入 Pi extension（需新写，复用 `before_agent_start` + 工具调用/LLM hook）
4. 跑通端到端：两个运行时各跑一次任务，遥测事件落库 + Dashboard 可见

### 1.2 验收标准（0.9）

| # | 验收项 | 通过条件 |
|---|--------|----------|
| 1 | SDK dist 构建 | `packages/sdk/dist/index.js` + `dist/plugins/opencode-plugin.js` + `.d.ts` 都存在 |
| 2 | CLI dist 构建 | `packages/cli/dist/index.js` 存在，带 shebang |
| 3 | OpenCode 插件加载 | opencode 启动时插件加载成功，无报错；工具调用不被阻断 |
| 4 | Pi extension 加载 | Pi 启动时 extension 加载成功，无报错；工具调用不被阻断 |
| 5 | OpenCode 遥测落库 | 跑一次任务，`telemetry_logs` 表有 `tool_call` 和 `token_usage` 两类事件 |
| 6 | Pi 遥测落库 | 跑一次任务，`telemetry_logs` 表有 `tool_call` 和 `token_usage` 两类事件 |
| 7 | Dashboard 可见 | Dashboard 上出现两个运行时的调用次数/成本，活动流有事件 |
| 8 | 降级安全 | Agent-Hub 未启动时，两个运行时的工具调用仍正常放行（不阻断）；降级有日志 |

---

## 2. 进数据契约（拍死）

**所有运行时的遥测统一走 Agent-Hub 自己的上报 API，不混 OTLP。**

- **端点**: `POST /api/v1/telemetry/batch`（已存在，幂等 event_id）
- **认证**: Agent Token（JWT，90 天有效期，CLI connect 时获取，存 `~/.agent-hub/config.json`）
- **事件类型**: 复用现有 `EventType` enum（`tool_call` / `token_usage` / `permission_denied` / `heartbeat` / `key_failover` 等）
- **批量上报**: DataReporter 内置批量窗口 + 心跳，上报失败静默（不阻断主流程）

**将来接 Claude Code / Gemini / Codex 时**：各写各的 hook/extension，但都 POST 到同一个 `/api/v1/telemetry/batch`。不加 OTLP 接收端点，不混协议。

**业界验证（2026-08-29 调研）**：Langfuse 官方文档明确写了各 coding agent 的遥测接入方式——GitHub Copilot 原生 OTLP，**Claude Code / OpenAI Codex 用 lifecycle hook 上报每个 session**，Cursor / Kiro / **OpenCode** / Augment Code 有专门集成。我们"用 hook/插件上报遥测到自己的 API"的方案与业界标准做法一致。事件类型可参考 Langfuse taxonomy（Generation=LLM 调用+token、Tool=函数调用、Agent=agent 级操作）。

---

## 3. 坑 1 修复：SDK tsup entry 加 opencode-plugin

### 3.1 问题

`packages/sdk/tsup.config.ts` 的 entry 是 `["src/index.ts"]`，只构建主入口。但 `package.json` 的 exports 声明了：

```json
"./opencode-plugin": {
  "types": "./dist/plugins/opencode-plugin.d.ts",
  "import": "./dist/plugins/opencode-plugin.js"
}
```

**即使跑了 build，`dist/plugins/opencode-plugin.js` 也不会生成**，引用会 404。

### 3.2 修复

修改 `packages/sdk/tsup.config.ts`：

```typescript
export default defineConfig({
  entry: ["src/index.ts", "src/plugins/opencode-plugin.ts"],  // 加 plugin
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["@opencode-ai/plugin"],
});
```

### 3.3 验证

构建后确认：
- `dist/index.js` + `dist/index.d.ts` 存在
- `dist/plugins/opencode-plugin.js` + `dist/plugins/opencode-plugin.d.ts` 存在
- `opencode-plugin.js` 里的相对导入（`../local-cache` 等）被 tsup bundle 正确解析

---

## 4. 坑 2 修复：permission.ask 降级策略（三条）

### 4.1 问题

`packages/sdk/src/plugins/opencode-plugin.ts` 的 `permission.ask` hook，catch 块直接 `output.status = "deny"`（安全优先）。这意味着：

- Agent-Hub 未启动 / SDK 初始化失败 / 网络不通 → 所有工具调用被 deny → **OPC-Agents 完全不能干活**

这违反红线："上报失败一律静默，绝不阻断 OPC-Agents 正常运行"。

### 4.2 修复原则（三条，不是无脑 allow）

**第一条：只在"够不到 hub"时放行；hub 明确返回 deny 必须照办。**

区分两类情况：
- **够不到 hub**：SDK 初始化失败、超时（500ms）、网络异常、缓存不可读 → 降级放行
- **hub 明确拒绝**：`checker.check()` 正常返回 `"deny"` → 必须 deny，不能放行

当前 `PermissionChecker.check()` 是本地规则匹配（用 LocalCache 的规则），不是远程调用。所以"够不到 hub"= SDK 初始化失败 / checker.check() 抛异常 / 超时。"明确 deny"= checker.check() 正常返回 "deny"。

**第二条：safety mode 开启时 fail-closed。**

设计里有一键 lockdown（safety mode）。降级逻辑必须尊重它：
- safety mode 开启 + 够不到 hub → **deny**（不能偷偷放行）
- safety mode 关闭 + 够不到 hub → allow（降级放行）

safety mode 状态从 `PermissionChecker` 的 `safetyMode` 字段读（LocalCache 里的权限配置），或从 OpenCode 传入的 `perm.safetyMode` 读。

**第三条：每次降级放行大声记一条日志。**

```
[AgentHub] PERMISSION DEGRADED: hub unreachable, allowing tool=<name> (safetyMode=off)
```

让用户事后知道"这段时间权限层被绕过了"。日志写到 stderr（OpenCode 插件的标准输出），同时可以上报一条 `permission_degraded` 遥测事件（如果上报通道可用）。

### 4.3 具体代码改动

修改 `packages/sdk/src/plugins/opencode-plugin.ts` 的 `permission.ask` hook：

```typescript
"permission.ask": async (perm: Permission, output: { status: string }) => {
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
      reporter.reportEvent({...}).catch(() => {});
    } else {
      output.status = "ask";
    }
  } catch (err) {
    // 够不到 hub：检查 safety mode
    const safetyOn = perm.safetyMode === true;
    if (safetyOn) {
      // safety mode 开启 → fail-closed
      console.warn(`[AgentHub] PERMISSION FAIL-CLOSED: hub unreachable + safetyMode=on, denying tool=${perm.toolName}`);
      output.status = "deny";
    } else {
      // safety mode 关闭 → 降级放行
      console.warn(`[AgentHub] PERMISSION DEGRADED: hub unreachable, allowing tool=${perm.toolName} (safetyMode=off)`);
      output.status = "allow";
    }
  }
},
```

同时修改 `PermissionChecker.timeout()`：超时返回的是 `"deny"`，这会被当成"明确 deny"。需要区分"超时"和"明确 deny"——超时应该走降级逻辑，不是直接 deny。

方案：`check()` 超时时抛异常（而不是返回 "deny"），让上层 catch 走降级逻辑。

```typescript
private async timeout(ms: number): Promise<never> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  throw new Error("Permission check timeout");
}
```

### 4.4 验证

1. Agent-Hub 未启动 + safetyMode=off → 工具调用放行，有 DEGRADED 日志
2. Agent-Hub 未启动 + safetyMode=on → 工具调用 deny，有 FAIL-CLOSED 日志
3. Agent-Hub 启动 + 规则明确 deny 某工具 → 该工具 deny（不是降级）
4. Agent-Hub 启动 + 规则 allow → 工具 allow

---

## 5. OpenCode 接入方案

### 5.1 现状

- 插件代码已写好：`packages/sdk/src/plugins/opencode-plugin.ts`
- 三个 hook：`permission.ask`（权限拦截）+ `tool.execute.before`（工具调用上报）+ `llm.completion`（Token 用量上报）
- opc-agents 的 `opencode.json` 当前**未引用**插件（被回滚）
- opc-agents 的 `package.json` 已挂 `@agent-hub/sdk: file:../agent-hub/packages/sdk`，但 dist 未构建

### 5.2 接入步骤

1. 修坑 1（tsup entry）+ 坑 2（降级策略）
2. 构建 SDK：`cd packages/sdk && npm run build`
3. 构建 CLI：`cd packages/cli && npm run build`
4. opc-agents 重新 link：`cd /Users/souljian/code/opc/opc-agents && npm install`（file: 依赖会重新链接）
5. 用 CLI 连接：`agent-hub connect`（扫描本地 .opencode/agents/，注册 agent，获取 agent token，存 ~/.agent-hub/config.json）
6. 在 `opencode.json` 接入插件：
   ```json
   {
     "plugin": ["@agent-hub/sdk/opencode-plugin"]
   }
   ```
   （已确认：OpenCode 官方文档 `opencode.ai/docs/plugins/` 明确 `"plugin"` 字段为数组，支持 npm 包名+子路径，如 `"opencode-helicone-session"`、`"@my-org/custom-plugin"`）
7. 启动 OpenCode，确认插件加载成功
8. 跑一次测试任务，验证遥测落库

### 5.3 红线

- 只改 `opencode.json`（运行时配置层），不碰 `prompts/`、`CLAUDE.md`、`routing.yaml` 等受保护文件
- 插件上报失败一律静默，绝不阻断 OPC-Agents 正常运行（坑 2 修复保证）

---

## 6. Pi 接入方案

### 6.1 现状

- Pi 已有 `before_agent_start` hook 的模板：`.pi/hooks/opc-session-hook.ts.template`（用于会话启动自检，不是遥测上报）
- Pi extension 安装位置：`~/.pi/agent/extensions/*.ts`
- Pi extension API：默认导出函数，接收 `pi` 对象，`pi.on("before_agent_start", handler)` 注册 hook
- **工具调用 hook 已确认存在**（2026-08-29 调研）：`pi.on("tool_call", handler)`，可拦截工具调用前事件，`event.toolName` / `event.input` 可用，可 `return { block: true, reason }` 拦截

### 6.2 Pi hook 清单（已确认 + 待实测）

| Hook | 触发时机 | 用途 | 状态 |
|------|----------|------|------|
| `before_agent_start` | Agent 启动前 | 注入上下文（会话自检）+ heartbeat 事件 | ✅ 已确认 |
| `tool_call` | 工具调用前 | 上报 `tool_call` 事件 | ✅ 已确认（pi.dev 官方文档 + 腾讯云开发者社区文章验证） |
| `message_end` / `turn_end` | 消息/轮次结束 | 上报 `token_usage` 事件 | 🟡 待实测（hook 体系里有，但 token 用量字段名需写 extension 时打印 payload 确认） |

### 6.3 调研结论（2026-08-29）

Pi 的完整 hook 体系（来自 pi.dev/docs/latest/extensions）：

```
before_agent_start (可注入 message、修改 system prompt)
agent_start
message_start / message_update / message_end
  └── turn (LLM 调用工具时重复)
      ├── turn_start
      ├── tool_call ← 已确认，可拦截
      └── turn_end
```

**结论**：Pi 有原生 `tool_call` hook，可以上报 `tool_call` 事件。之前设计文档里"Pi 没有工具调用 hook"的假设是错的。LLM token 用量大概率在 `message_end` / `turn_end` 事件的 payload 里，写 extension 时实测确认字段名。

**备选方案 C（Pi 只有会话级遥测）已删除**——Pi 工具调用 hook 已确认存在，不需要降级。

### 6.4 Pi extension 设计（假设工具调用 hook 存在）

新建 `packages/sdk/src/plugins/pi-extension.ts`：

```typescript
import { execSync } from "child_process"
import * as path from "path"

// 复用 DataReporter（与 OpenCode 插件同一个上报通道）
import { DataReporter } from "../data-reporter"
import { LocalCache } from "../local-cache"

const PROJECT_DIR = process.env.OPC_AGENTS_PATH || path.join(process.env.HOME || "~", "code", "opc", "opc-agents")
const CONFIG_PATH = path.join(process.env.HOME || "~", ".agent-hub", "config.json")

let reporter: DataReporter | null = null
let agentId: string | null = null

function getConfig(): { apiBaseUrl: string; authToken: string; agentId: string } {
  const config = JSON.parse(require("fs").readFileSync(CONFIG_PATH, "utf-8"))
  return config
}

function getReporter(): DataReporter {
  if (reporter) return reporter
  const config = getConfig()
  agentId = config.agentId  // 从 config 读，跟 seed 脚本建的 Agent 行 id 一致
  reporter = new DataReporter({
    apiBaseUrl: config.apiBaseUrl,
    authToken: config.authToken,
    agentId: config.agentId,
  })
  reporter.start().catch(() => {})
  return reporter
}

export default function (pi: any) {
  // 会话启动 → heartbeat/session_start 事件
  pi.on("before_agent_start", async (event: any, _ctx: any) => {
    try {
      const r = getReporter()
      r.reportImmediately({
        type: "heartbeat",
        agentId: agentId || "pi-director",
        payload: { event: "session_start", prompt: event?.prompt?.slice(0, 200) },
        timestamp: Date.now(),
      }).catch(() => {})
    } catch {}
    // 不返回 message（不注入上下文，那是 opc-session-hook 的事）
  })

  // 工具调用前 → tool_call 事件（已确认 hook 名：tool_call）
  pi.on("tool_call", async (event: any, _ctx: any) => {
    try {
      const r = getReporter()
      r.reportImmediately({
        type: "tool_call",
        agentId: agentId || "pi-director",
        payload: { toolName: event?.toolName, toolInput: event?.input },
        timestamp: Date.now(),
      }).catch(() => {})
    } catch {}
  })

  // LLM 完成后 → token_usage 事件（hook 名待实测：message_end 或 turn_end，token 字段名打印 payload 确认）
  pi.on("message_end", async (event: any) => {
    try {
      // 实测时先 console.log(JSON.stringify(event)) 确认 token 用量字段
      const r = getReporter()
      r.reportImmediately({
        type: "token_usage",
        agentId: agentId || "pi-director",
        payload: { model: event?.model, promptTokens: event?.usage?.promptTokens, completionTokens: event?.usage?.completionTokens },
        timestamp: Date.now(),
      }).catch(() => {})
    } catch {}
  })
}
```

### 6.5 Pi extension 安装

1. 构建 SDK（tsup entry 加 `src/plugins/pi-extension.ts`）
2. 复制 `dist/plugins/pi-extension.js` 到 `~/.pi/agent/extensions/agent-hub-telemetry.ts`（或 .js，看 Pi 支持哪种）
3. 重启 Pi
4. 确认 extension 加载成功，无报错

---

## 7. 分支与回滚策略

### 7.1 分支

两个仓库各开分支：
- **agent-hub**: `feat/workbench-phase0-wiring`（修坑 + 构建 + Pi extension）
- **opc-agents**: `feat/agent-hub-wiring`（opencode.json 插件引用 + npm link）

### 7.2 回滚

如果插件把 OpenCode/Pi 启动搞挂：
1. 从 `opencode.json` 删掉 `"plugin"` 字段 → 立即恢复
2. 从 `~/.pi/agent/extensions/` 删掉 agent-hub extension → 立即恢复
3. 两个仓库的分支都不合并 main，实验隔离

### 7.3 快照

动手前确认两个仓库的 main 都是干净的（已确认），分支就是快照。

---

## 8. 风险与开放问题

| # | 风险/问题 | 严重度 | 应对 |
|---|-----------|--------|------|
| 1 | OpenCode plugin 配置格式 | ✅ 已确认 | `"plugin": ["@agent-hub/sdk/opencode-plugin"]`，官方文档验证 |
| 2 | Pi 工具调用 hook | ✅ 已确认 | `pi.on("tool_call", handler)`，官方文档+社区文章验证 |
| 3 | Pi token_usage 字段名 | 🟡 中 | 写 extension 时先 `console.log(JSON.stringify(event))` 打印 payload 确认，字段名可能是 `event.usage.promptTokens` 或其他 |
| 4 | `agent-hub connect` CLI 未实测 | 🟡 中 | **绕过 CLI，写一次性 seed 脚本**：建 Account + Agent 行、签 agent token、写 `~/.agent-hub/config.json`（apiBaseUrl/token/agentId）。connect CLI 的完整体验当成后面独立小任务，不在阶段 0 修 |
| 5 | Agent-Hub 数据库可能为空/未 migration | 🟢 低 | 启动前跑 `npx prisma migrate deploy` |
| 6 | Pi extension 的 TypeScript 语法 Pi 是否原生支持 | 🟡 中 | 如果 Pi 只支持 .js，构建产物已经是 .js（tsup 输出 ESM），直接用 dist |
| 7 | 降级放行日志刷屏 | 🟢 低（基本不存在） | `PermissionChecker.check()` 是纯本地规则匹配、无 per-call 网络往返，"够不到 hub"只在冷初始化（读 config/cache 失败）那一下触发，不会每次工具调用都降级。节流（同一工具只打第一次）是锦上添花，非必需 |

---

## 9. 实施顺序（细化）

| 步 | 动作 | 仓库 | 验证 |
|---|------|------|------|
| 0.1 | 修 tsup entry（加 opencode-plugin + pi-extension） | agent-hub | dist/plugins/ 下两个文件都生成 |
| 0.2 | 修 permission.ask 降级策略三条 + PermissionChecker 超时抛异常 | agent-hub | 4 种场景单测通过 |
| 0.3 | 写 Pi extension（pi-extension.ts） | agent-hub | 构建通过，语法无错 |
| 0.4 | 构建 SDK + CLI | agent-hub | dist 产物齐全 |
| 0.5 | 启动 Agent-Hub（确认数据库 + migration） | agent-hub | localhost:3000 可访问 |
| 0.6 | opc-agents npm link SDK | opc-agents | node_modules/@agent-hub/sdk 指向正确 |
| 0.7 | **写 seed 脚本**：建 Account + Agent 行、签 agent token、写 `~/.agent-hub/config.json` | agent-hub | config.json 生成，Agent 行在库里 |
| 0.8 | opencode.json 接入插件 | opc-agents | OpenCode 启动插件加载成功 |
| 0.9 | Pi extension 安装 | 本地 | Pi 启动 extension 加载成功 |
| 0.10 | OpenCode 跑测试任务 → 验遥测落库 | 端到端 | telemetry_logs 有 tool_call + token_usage |
| 0.11 | Pi 跑测试任务 → 验遥测落库 | 端到端 | telemetry_logs 有 Pi 侧事件 |
| 0.12 | Dashboard 验证可见 | 端到端 | 两个运行时的数据都显示 |

---

## 10. 不在阶段 0 范围

- UI 改动（Dashboard 复用现有，不新增页面）
- Task/Decision/AgentProfile 模型（阶段 2-3）
- 去多租户重构（阶段 1）
- Claude Code / Gemini / Codex 接入（阶段 1 或更后）
- 成本按角色切分（阶段 1）
- 审批中心/任务指挥台（阶段 2-3）

---

**待评审决策点：**

1. ~~Pi 如果没有工具调用/LLM hook，接受"Pi 侧只有会话级遥测"吗？~~ **已解决**：Pi 有原生 `tool_call` hook（已确认），token_usage 字段名写 extension 时实测确认，不需要降级。
2. ~~`agent-hub connect` CLI 有 bug 时顺手修还是绕过？~~ **已拍板**：绕过，写一次性 seed 脚本（建 Account + Agent + 签 token + 写 config.json），connect CLI 完整体验当成后面独立小任务。
3. ~~降级放行日志上报 hub 还是只打 stderr？~~ **已拍板**：stderr 必打（主信号）+ 顺手 enqueue `permission_degraded` 事件靠批量窗口补传（可能丢）+ 节流（同一工具只打第一次，锦上添花非必需）。
