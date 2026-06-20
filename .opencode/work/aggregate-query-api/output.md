# 聚合查询 API 端点 — 完成报告

## 创建的文件

| 文件 | 行数 | 描述 |
|------|------|------|
| `src/app/api/v1/agents/[id]/cost-trend/route.ts` | 180 | 花费趋势（按天） |
| `src/app/api/v1/agents/[id]/cost-breakdown/route.ts` | 194 | 花费明细（按模型） |
| `src/app/api/v1/dashboard/route.ts` | 369 | 仪表盘概览 |
| `src/app/api/v1/keys/[id]/usage/route.ts` | 270 | Key 用量汇总 |
| **总计** | **1013** | |

## 端点详情

### 1. GET /api/v1/agents/[id]/cost-trend?range=7d|30d
- 从 telemetry_logs 查询 `token_usage` 事件
- 按天聚合，计算每日花费和调用次数
- 匹配 models 表定价计算 cost：`(promptTokens * pricingInput + completionTokens * pricingOutput) / 1_000_000`
- 默认 range=7d，支持 30d
- 未匹配到定价的 model 计为 0

### 2. GET /api/v1/agents/[id]/cost-breakdown?range=7d|30d
- 同数据源，按 model 分组
- 包含 displayName、调用次数、tokens 用量、花费占比
- 按 cost 降序排列
- 百分比精确到小数点后 2 位

### 3. GET /api/v1/dashboard
- **指标聚合**：agent 数量/运行中/错误数、key 数量/健康/警告、本月总花费、今日调用数、今日拦截数
- **Agent 列表**：包含状态、当前 key、今日调用、月花费、最后心跳
- **7 天花费趋势**
- **Key 概览**：包含 provider、健康状态、余额、消耗速率
- 使用 `Promise.all` 并行查询优化

### 4. GET /api/v1/keys/[id]/usage?range=7d|30d
- 返回 key 基本信息、用量汇总、按 agent 分组的调用量、每日趋势
- failoverCount 统计该 key 作为 failover 备用目标的切换次数

## 遵循的模式

- 所有端点使用 `getAuthUser` 认证
- 验证 agent/key 所有权（`accountId` 检查）
- 统一的错误处理（`ApiError` + try/catch）
- App Router `route.ts` 格式，TypeScript
- 使用 `@/lib/prisma` 和 `@/lib/auth` 路径别名

## 构建状态

- TypeScript 通过（预存在的 packages/sdk 错误除外）
- `npm run build` 需要先安装 `@opencode-ai/plugin` 类型声明才能通过全量构建