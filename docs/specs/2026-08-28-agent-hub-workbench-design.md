# Agent Hub 重构设计：OPC-Agents 运营中台（工作台）

- **版本**: v1.0（待评审）
- **日期**: 2026-08-28
- **状态**: DRAFT —— 供评审，未开始实现
- **评审对象**: OPC-Agents 体系 + Agent Hub 重构

---

## 0. 文档目的

本设计文档定义 Agent Hub 从「通用的多 Provider API Key 管理平台」重构为「OPC-Agents 数字员工运营中台」（下称"工作台"）的完整方案。**OPC-Agents 保持不变**，本设计只在其外层做"运营层"。

任何一段可直接作为实现依据；标注 `[待确认]` 处为需要评审决策的点。

---

## 1. 背景与问题

### 1.1 现状

- **OPC-Agents**：一人公司（One Person Company）AI Agent 团队系统。Director + 9 个子 Agent 的调度式协作。核心是 `prompts/`（唯一真相源）→ `adapters/<runtime>.yaml`（声明式转换）→ `generate-agents.py`（生成器）→ 五运行时产物（OpenCode / Claude Code / Pi / Gemini / Codex）。调度中枢 `routing.yaml`。质量闭环：AgentManager 五维评分、`feedback.schema.json`、lessons 教训库、benchmark 盲评、state-manager 中断恢复。
- **Agent Hub**：通用 AI Agent 管理平台（Next.js 16 + Prisma 7 + PostgreSQL）。功能：多 Key 管理（AES-256-GCM 加密、自动 failover）、权限系统、成本监控、SSE 实时流、预算强制执行、Dashboard、SDK + CLI。

### 1.2 已发生的接合尝试（事实）

- `opc-agents/package.json` 已挂 `@agent-hub/sdk` 为 `file:../agent-hub/packages/sdk` 本地依赖。
- 曾尝试 `opencode.json` 里 `"plugin": ["agent-hub"]` → 后改 `["@agent-hub/sdk"]`，**当前 opencode.json 中已无 plugin 引用（接入未生效/被回滚）**。
- `work/fix-agent-hub-3-issues` 记录：已修 scanner 权限提取、key 注册 404、telemetry 上报（dashboard 已验证 `calls=1`）。
- 现存隐患：SDK `dist/` 未构建；插件用了无 `.ts` 后缀的相对导入（Node 原生 TS 支持会挂）。

### 1.3 用户明确的诉求

1. 不做「显示台」（只有监控/展示），做「工作台」——创始人坐在上面能**发布任务、让 OPC-Agents 干活**，同时兼顾显示。
2. OPC-Agents **只在本地 Mac 运行**，无服务器部署需求。
3. 不做 MVP 阉割版——一次把设计做完整，实现按垂直切片推进，实现完再测、测完修 bug。
4. 不搞落伍的产品——方向是「数字员工团队的运营系统」，不是 agent 监控器或通用任务板。

### 1.4 评审时要判断的根本问题

> **"把 Agent 当员工管理"这个产品定位，值不值得做？有没有真实需求？有没有竞品在做？**

---

## 2. 产品定位

**Agent Hub 重构为「OPC-Agents 运营中台」——创始人坐在上面指挥一支数字员工团队的工作台。**

不是监控屏、不是任务板，是把"管理一支 AI Agent 团队"这件事产品化的控制平面。

**一句话**：OPC-Agents 是"员工"，Agent Hub 是"公司运营系统"。

### 2.1 核心差异（vs 上一版 Agent Hub）

| 维度       | 旧 Agent Hub   | 新工作台                         |
| ---------- | -------------- | -------------------------------- |
| 信息中心   | Key / Provider | **Task / Agent（员工）**         |
| 创始人动作 | 只看           | **发布任务 + 审批决策 + 管员工** |
| 信息流     | 单向（展示）   | 双向（指挥 + 反馈）              |
| 系统关系   | 独立平台       | **OPC-Agents 的运营外壳**        |

### 2.2 未来产品特性（评审重点）

| #   | 能力                         | 说明                                                                                          | 第一版      |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------- | ----------- |
| 1   | **数字员工运营 (Agent Ops)** | 员工档案、五维评分趋势、benchmark 回归、教训回流、prompt 版本管理（类 CI/CD 管理 Agent 迭代） | ✅ 核心     |
| 2   | **决策审批流**               | Agent 要拍板 → 带上下文的审批卡推给创始人 → 通过/打回/追问 → 喂 feedback 闭环                 | ✅ 核心     |
| 3   | **任务即项目**               | 有状态、子任务树、可中断续跑、产出归档                                                        | ✅ 核心     |
| 4   | **成本即战略**               | 预算执行、模型路由建议、每个 Agent 的 ROI                                                     | ✅ 增强     |
| 5   | **五运行时统一指挥**         | 一个面板看 OpenCode/Claude/Pi/Gemini/Codex 状态，一键拉起干活                                 | ✅ 收尾增强 |

> **判断依据**：到 2026-2027，行业从"怎么让单个 agent 干活"转向"怎么管理一支 agent 团队"。OPC-Agents 恰好就是那支团队。市面上此类定位（如 Mission Control）仍偏"监控 + 派发"，未覆盖"员工运营"这一层。

---

## 3. 系统架构

### 3.1 三层架构

```text
┌─────────────────────────────────────────────────┐
│ L1 创始人工作台 (Web, Next.js, 现有代码重构)       │
│   任务指挥 | 决策审批 | 员工档案 | 成本 | 运行时状态 │
└──────────────────────────┬──────────────────────┘
                           │ REST + SSE（已有，升级）
┌──────────────────────────▼──────────────────────┐
│ L2 Agent Hub 核心 (API + Prisma, 现有代码升级)    │
│   Task状态机 | Decision审批 | AgentProfile评分     │
│   Key管理 | Cost | Telemetry | 预算执行（保留）    │
└──────────────────────────┬──────────────────────┘
                           │ ① file:本地依赖（已有）
                           │ ② 遥测上报（已有）
                           │ ③ CLI执行通道（新增 agent-hub run）
┌──────────────────────────▼──────────────────────┐
│ L3 OPC-Agents (本地 Mac, 零改动)                  │
│   prompts/ + routing.yaml + 10个Agent + 五运行时  │
└─────────────────────────────────────────────────┘
```

### 3.2 分层职责与改动策略

| 层                | 职责                                        | 改动        |
| ----------------- | ------------------------------------------- | ----------- |
| L3 OPC-Agents     | 怎么干活（角色/调度/prompt）                | **零改动**  |
| L2 Agent Hub 核心 | 怎么运营（任务/决策/绩效/成本）             | 重构 + 新增 |
| 边界              | 单向遥测（已有）+ 双向任务/决策通道（新增） | 补 SDK/CLI  |

### 3.3 关键原则

1. **OPC-Agents 零改动**：prompts/、routing.yaml、五运行时生成器全部保留。
2. **复用而非重写**：现有 SSE 事件流、telemetry、cost、加密、预算引擎、Dashboard 全部保留升级，只是信息从"按 Provider"重组为"按任务/按 Agent"。
3. **双向通道是新增价值**：旧版只有"Agent→Hub"的遥测；新版加"Hub→Agent"的任务下发与决策回传。

---

## 4. 数据模型（Prisma Schema 设计）

> 现有 12 个模型（Account/Agent/Provider/Key/KeyBinding/Permission/Model/TelemetryLog/TelemetryHourly/TelemetryDaily/FailoverLog/AuditLog）**大部分保留**，新增以下核心模型。

### 4.1 新增模型

#### Task（任务 = 项目）

```text
Task {
  id            String   @id @default(uuid())
  accountId     String
  title         String
  description   String?            // 创始人原始需求
  status        TaskStatus         // 见 §5 状态机
  priority      TaskPriority?      // [待确认] 是否需要
  parentTaskId  String?            // 子任务树
  agentId       String?            // 当前负责的 Agent（Director 或子 Agent）
  runtime       String?            // opencode/claude-code/pi/gemini/codex
  // 执行通道
  dispatchMethod String             // "terminal" | "sdk"（第一版 = terminal）
  command       String?            // 预填的启动指令 / 任务卡路径
  // 产出
  outputPath    String?            // OPC_WORK_PATH 下产出
  resultSummary String?
  // 状态位
  startedAt     DateTime?
  finishedAt    DateTime?
  deadlineAt    DateTime?          // [待确认]
  createdBy     String             // "founder" | "system"
  // 成本
  cost          Decimal @default(0)
  tokensIn      BigInt   @default(0)
  tokensOut     BigInt   @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

#### TaskEvent（任务时间线，全量审计）

```text
TaskEvent {
  id       String @id @default(uuid())
  taskId   String
  type     TaskEventType   // created | dispatched | started | awaiting_decision |
                           // decision_made | checkpoint | completed | failed | resumed | cancelled
  detail   Json?
  createdAt DateTime @default(now())
}
```

#### Decision（决策审批卡）

```text
Decision {
  id         String   @id @default(uuid())
  taskId     String?
  agentId    String?          // 提出决策的 Agent
  title      String           // "是否部署到生产" 等
  body       String           // Agent 的建议 + 理由 + 影响面
  options    Json             // [{label, description, risk}]
  context    Json             // 关联上下文（url、文件、日志）
  status     DecisionStatus   // pending | approved | rejected | questioned | expired
  founderComment String?      // 追问/批复内容
  createdAt  DateTime @default(now())
  decidedAt  DateTime?
  expiresAt  DateTime?        // [待确认] 过期自动默认值
}
```

#### AgentProfile（员工档案）

```text
AgentProfile {
  id          String @id @default(uuid())
  accountId   String
  role        String  @unique   // director/advisor/dev/... 与 prompts/ 对齐
  displayName String
  sourcePath  String            // prompts/<role>.md
  version     Int @default(1)
  status      AgentProfileStatus // active | deprecated
  // 五维评分（对齐 AgentManager 体系）
  scoreClarity   Decimal?   // 职责清晰度 30%
  scoreInterface Decimal?   // 协作接口 25%
  scoreRedline   Decimal?   // 红线质量 20%
  scoreSpec      Decimal?   // 规范遵循 15%
  scoreExperience Decimal?  // 经验丰富度 10%
  lastScore      Decimal?
  // 统计
  taskCount      Int @default(0)
  rejectRate     Decimal?   // 打回率
  avgCostPerTask Decimal?
  lastReviewedAt DateTime?
  createdAt DateTime @default(now())
}
```

#### AgentFeedback（feedback 闭环持久化）

```text
AgentFeedback {
  id        String @id @default(uuid())
  agentId   String?         // AgentProfile.id
  taskId    String?
  signal    String          // user_confirm | user_reject | user_rate
  rating    Int?            // 1-5
  comment   String?
  createdAt DateTime @default(now())
}
```

#### Checkpoint（任务中断恢复点）

```text
Checkpoint {
  id         String @id @default(uuid())
  taskId     String
  state      Json           // 与 scripts/state.json 对齐的序列化状态
  sessionNote String?       // work/session-notes.md 摘要
  createdAt  DateTime @default(now())
}
```

### 4.2 与现有模型的关系

```text
Account 1─* Task 1─* TaskEvent
Task    *─1 Decision   (一个任务可有多个决策)
Account 1─* AgentProfile 1─* AgentFeedback
Task    1─* Checkpoint
AgentProfile 关联 Agent（运行时实例，已有模型）
Task    1─* SubTask (self-relation parentTaskId)
```

### 4.3 保留的现有能力（不重写）

- Key 加密存储 + failover + KeyBinding 优先级（现有关键价值）
- TelemetryLog + 时/日聚合表（成本查询性能）
- 预算强制执行引擎（80% 告警 / 100% 禁用）
- SSE 事件总线（升级为"任务事件 + 决策事件"广播）
- AuditLog（新增 Task/Decision/AgentProfile 动作入审计）

---

## 5. 任务状态机

### 5.1 状态

```text
draft → queued → dispatched → running → awaiting_decision → running
                                  ↓                         ↓
                              completed / failed       (决策后回 running)
                                  ↓
                              archived / cancelled
```

| 状态                | 含义                              |
| ------------------- | --------------------------------- |
| `draft`             | 创始人草拟，未发布                |
| `queued`            | 已发布，等待执行（排队）          |
| `dispatched`        | 已通过 CLI/通道拉起，等待确认开始 |
| `running`           | 执行中                            |
| `awaiting_decision` | 需要创始人拍板（阻塞）            |
| `completed`         | 完成，产出已归档                  |
| `failed`            | 失败（可重试）                    |
| `cancelled`         | 创始人取消                        |
| `archived`          | 归档（只读）                      |

### 5.2 状态转换规则（合法迁移）

```text
draft        → queued | cancelled
queued       → dispatched | cancelled
dispatched   → running | failed | cancelled
running      → awaiting_decision | completed | failed | cancelled | resumed_from_checkpoint
awaiting_decision → running (approved/rejected后)
completed    → archived
failed       → queued (retry) | cancelled | archived
```

- 非法迁移返回 409，防状态错乱。
- 所有迁移落 `TaskEvent`（全量时间线）。

### 5.3 中断恢复

- 长任务中断（机器重启 / 会话关闭）→ `running` 变 `interrupted`（或保留 running + 标记 stale）`[待确认]`。
- 新会话 / 工作台重新拉起时，读取最近 `Checkpoint` + `session-notes.md`，生成恢复上下文。
- 与 OPC-Agents `scripts/state-manager.py` + `work/session-notes.md` 现有机制对齐（复用字段格式）。

---

## 6. 核心交互流

### 6.1 发布任务流（第一版 = 本地终端执行通道）

```text
[工作台] 点"新建任务" → 填 title/description/目标 Agent(默认 Director)/优先级
  → 保存 draft → 点"发布"
  → 后端生成 Task + 任务卡（.opencode/work/tasks/<taskId>.md，含完整需求+上下文）
  → 生成启动指令：agent-hub run <taskId>   （复制或一键）
  → 创始人在本地 OpenCode 终端执行 → Director 读取任务卡开始干活
  → SDK 遥测（tool_call/token/状态）实时回流 → 工作台任务进入 running
  → 干完 → CLI 回报 → 任务 completed + 产出路径归档
```

### 6.2 决策审批流（核心差异化）

```text
Agent 干活中触发"需要创始人拍板"
  → SDK 上报 decision_requested（带 title/body/options/context）
  → 工作台生成 Decision 卡，状态 pending
  → 任务状态变 awaiting_decision
  → 创始人看卡：通过 / 打回(附意见) / 追问
  → 决定回传（经 CLI 通道注入到运行中的 OpenCode 会话 / 写入任务卡的决策区）
  → 任务恢复 running
  → 打回/评分自动落 AgentFeedback → 进入员工档案统计
```

> `[待确认]` 决策回传的**注入机制**：第一版做法是"创始人决定写入任务卡的 `## 创始人批复` 区，Agent 看到后继续"。真正的运行时注入（向运行中的会话 push）留作扩展。

### 6.3 数字员工运营流

```text
AgentProfile 建档（从 OPC-Agents prompts/ 同步）
  → 每次任务完成 + 创始人反馈 → 更新评分/打回率/平均成本
  → 改 prompt 前 → 触发 benchmark 回归（调 opc-agents benchmark/ 脚本）
  → 通过 → 升 version → 生成器重新生成各运行时产物
  → 评分趋势/版本历史在员工档案页可视化
```

---

## 7. 页面结构（L1 工作台）

| 页面                   | 内容                                                                |
| ---------------------- | ------------------------------------------------------------------- |
| **任务指挥台**（首页） | 任务列表（状态/进度/负责人/花费）、发布任务入口、待审批红点         |
| **任务详情**           | 时间线（TaskEvent）、子任务树、产出、花费、关联决策、恢复/重试/取消 |
| **审批中心**           | 待处理 Decision 卡（建议+理由+影响面+一键决定）                     |
| **员工档案**           | 10 个 Agent 的评分雷达、趋势、打回率、版本历史、benchmark 状态      |
| **成本**               | 按任务/Agent/运行时的花费、预算执行、模型路由建议、ROI              |
| **Key 管理**           | （保留现有，按 Agent/运行时视图重组）                               |
| **运行时状态**         | 五运行时各自状态、在线/离线、最近活动、一键拉起                     |
| **审计日志**           | （保留现有）                                                        |

---

## 8. 执行通道与 OPC-Agents 接合（L2↔L3 边界）

### 8.1 通道形态（第一版）

| 通道     | 方向      | 实现                                                     |
| -------- | --------- | -------------------------------------------------------- |
| 遥测上报 | Agent→Hub | 已有（SDK DataReporter），修复并启用                     |
| 任务下发 | Hub→Agent | 新增 CLI：`agent-hub run <taskId>` 生成任务卡 + 启动指令 |
| 决策回传 | Hub→Agent | 新增：写入任务卡决策区（第一版）；运行时注入（扩展）     |
| 状态回报 | Agent→Hub | 新增 CLI：`agent-hub report` / SDK 心跳扩展              |

### 8.2 SDK 修复（接合的前提）

- 构建 `dist/`（tsup），修复无 `.ts` 后缀相对导入问题（加 `.js`/`.ts` 或改 tsup 处理）。
- opencode-plugin 真正接入 `opencode.json`（`"plugin": ["@agent-hub/sdk"]`）。
- 插件默认降级为安全放行（不阻塞 Agent 干活），上报失败静默。

### 8.3 首次连接引导

```text
agent-hub init
  → 检测本机 OPC-Agents 目录
  → 同步 prompts/ → 生成 10 个 AgentProfile 档案
  → 生成/复用 API Key（已有加密存储）
  → 完成工作台-本地运行时握手
```

---

## 9. 复用 / 废弃 / 新增清单

### 保留（升级不重写）

SSE 事件流、TelemetryLog + 聚合表、Key 加密/failover/KeyBinding、预算引擎、AuditLog、Dashboard 基础组件、认证体系。

### 废弃 / 收敛

- 通用"Discover Models 全流程"（保留，但不再作为首页重心）。
- 与 OPC-Agents 无关的通用多租户工作区概念收敛为单用户（本机 Mac）。`[待确认]`
- 过时文档（ARCHITECTURE.md 等）重写。

### 新增

Task/TaskEvent/Decision/AgentProfile/AgentFeedback/Checkpoint 模型、任务发布与状态机、审批中心、员工档案页、`agent-hub run/report` CLI、任务卡生成器、五运行时状态页。

---

## 10. 技术风险与对策

| 风险                                   | 对策                                                                 |
| -------------------------------------- | -------------------------------------------------------------------- |
| 决策回传无法实时注入运行中会话         | 第一版用"任务卡批复区"兜底，运行时注入留扩展                         |
| OpenCode 插件在原生 Node TS 下加载失败 | 构建 dist + 修复导入后缀 + 降级放行                                  |
| 任务与 OPC-Agents 实际执行状态可能脱节 | 遥测 + CLI 状态回报双通道对账；任务卡内嵌状态                        |
| 数据模型一次性改动大                   | 垂直切片：先做"发布→执行→回收"最小完整链路，再叠加审批/档案/成本视图 |
| 单机运行（无服务器）限制并发           | 本机任务队列串行或有限并发，不做分布式                               |

---

## 11. 实施顺序（垂直切片，非水平分层）

1. **切片 A（地基）**：Task 模型 + 状态机 + 任务卡生成 + `agent-hub run/report` CLI + SDK 修复 + 遥测回流打通。→ 端到端"发任务→干活→回收"跑通。
2. **切片 B（决策）**：Decision 模型 + 审批中心 + 决策回传 + awaiting_decision 状态。
3. **切片 C（员工运营）**：AgentProfile 同步 + 评分 + feedback 闭环 + 档案页。
4. **切片 D（增强）**：成本视图重组 + 模型路由建议 + ROI + 预算执行可视化。
5. **切片 E（收尾）**：五运行时状态页 + 一键拉起 + 审计扩展 + 文档重写。

每个切片都是完整可测的闭环；全部完成后整体联测、按 bug 清单修复。

---

## 12. 待评审决策点汇总（[待确认] 清单）

1. Task 是否需要 priority / deadline？
2. 中断后状态用 `interrupted` 还是保留 `running` + stale 标记？
3. 决策回传第一版用"任务卡批复区"是否可接受？
4. 是否收敛为单用户（本机 Mac）模型？
5. 五维评分直接复用 AgentManager 权重（30/25/20/15/10）还是工作台另设？
6. "数字员工运营"作为产品定位，评审方是否认可其差异化价值？

---

## 附录 A：参照产品

- **Mission Control**（builderz-labs）：自托管 AI agent 控制平面，派发任务/检查运行/审查失败/跟踪花费/协调运行时。SQLite 本地，OpenClaw/Claude Code/Codex 通用。**偏监控+派发，未做员工运营层。**
- **Commander.ai**：FastAPI + LangGraph + Next.js，多 agent 编排 + 记忆 + 绩效评估 + reward。**偏 LangGraph 技术栈，非 OPC 式 prompt 单源。**
- **Claude Code DevConsole / agent view**：管理多个 Claude 会话的视图。**偏单运行时。**
