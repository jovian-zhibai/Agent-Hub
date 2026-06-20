# 修复 Agent Hub CLI 注册 Agent 时报 405 Method Not Allowed

## 根因分析

CLI 在 `packages/cli/src/utils/api.ts` 第 147 行调用 `POST /api/v1/agents` 注册 Agent，但后端 `src/app/api/v1/agents/route.ts` **仅导出了 `GET` 处理函数**，没有 `POST` 处理函数。Next.js App Router 对未导出的 HTTP 方法自动返回 `405 Method Not Allowed`。

## 修改内容

**文件**: `src/app/api/v1/agents/route.ts`

- 新增 `POST` 函数（第 134–178 行）
- 接收 `{ name, type/framework, machineId }` 请求体
- CLI 发送 `type` 字段，但 Prisma schema 使用 `framework`，做兼容映射
- 返回 `201 Created` 和创建的 Agent 信息
- 统一使用与 `GET` 一致的错误处理模式

## 验证结果

| 场景 | 结果 |
|------|------|
| `POST /api/v1/agents` (带有效 token) | `201 Created` ✅ |
| `GET /api/v1/agents` (回归) | `200 OK` ✅ |
| `POST /api/v1/agents` (无 token) | `401 AUTH_ERROR` ✅ |

## 影响范围

- 仅 `src/app/api/v1/agents/route.ts` 新增函数，不影响已有路由
- 不涉及数据库迁移、配置变更或第三方依赖
