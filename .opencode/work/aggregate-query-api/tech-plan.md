# 技术方案：Agent Hub 聚合查询 API

## 背景
前端面板需要四个聚合查询端点来展示仪表盘、花费趋势、花费明细和 Key 用量。

## 方案

### 端点概览

| 端点 | 用途 | 数据源 |
|------|------|--------|
| `GET /api/v1/agents/[id]/cost-trend` | 按天花费趋势 | telemetry_logs (token_usage) + models 定价 |
| `GET /api/v1/agents/[id]/cost-breakdown` | 按模型花费明细 | telemetry_logs (token_usage) + models 定价 |
| `GET /api/v1/dashboard` | 仪表盘概览 | agents + keys + telemetry_logs |
| `GET /api/v1/keys/[id]/usage` | Key 用量汇总 | telemetry_logs + failover_logs |

### 关键设计决策

1. **Cost 计算方式**：从 token_usage payload 提取 `model`、`promptTokens`、`completionTokens`，匹配 models 表定价计算 cost。公式：`cost = (promptTokens * pricingInput + completionTokens * pricingOutput) / 1_000_000`。如果 models 表没有匹配的定价，cost 计为 0。

2. **模型匹配策略**：将所有 active 的 model 加载到 `Map<modelName, model>` 中。若同一 modelName 有多个 provider 的定价，取第一条。这是因为 telemetry payload 只存 model name 字符串，不存 provider 信息。

3. **聚合策略**：由于 Prisma 不支持 SQL DATE_TRUNC 原生聚合，采用"全量查询 + JS 聚合"模式。对于 7d/30d 范围，数据量可控。

4. **Dashboard 优化**：所有查询并行执行，用 `Promise.all` 减少总延迟。

### 影响范围

- 新增 4 个 route.ts 文件
- 不修改现有代码
- 不涉及数据库迁移

### 风险评估

| 风险 | 级别 | 缓解措施 |
|------|------|---------|
| telemetry_logs 数据量大 | 低 | range 参数限制时间范围，最多 30 天 |
| 模型定价未匹配 | 低 | cost 计为 0，不阻断查询 |
| Dashboard 查询过多 | 低 | 并行查询 + 合理超时 |

### 工作量估计

约 300-400 行 TypeScript，4 个文件。

### 写入规则

- 遵循现有 API 错误处理模式（ApiError + try/catch）
- 使用 getAuthUser 认证
- 验证 agent/key 所有权
- 使用 `@/lib/prisma` 和 `@/lib/auth` 路径别名