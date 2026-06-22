# 🔍 Agent Hub 项目扫描报告

> 扫描时间: 2026-06-21  
> 项目类型: Next.js 16 (canary) + Prisma 7 + PostgreSQL  
> 扫描范围: 全部核心源码、配置、数据库 Schema、Docker 部署

---

## 📊 问题总览

| 严重级别 | 数量 | 说明 |
|---------|------|------|
| 🔴 **CRITICAL** | **8** | 导致功能完全失效或严重安全漏洞 |
| 🟠 **HIGH** | **8** | 安全隐患或架构缺陷 |
| 🟡 **MEDIUM** | **10** | 代码质量 / 可维护性问题 |
| 🟢 **LOW** | **6** | 改进建议 |

---

## 🔴 CRITICAL — 致命缺陷

### C1. `crypto.ts` 加密函数返回硬编码空值（API Key 永远无法正确加密）

**文件:** `src/lib/crypto.ts` 第 67 行

```typescript
// 当前代码（错误）:
return `::`;  // ← 硬编码返回，加密结果永远为 "::"

// 应该是:
return `${iv.toString(ENCODING)}:${encrypted}:${authTag.toString(ENCODING)}`;
```

**影响:** 所有 API Key 存入数据库的 `key_encrypted` 字段都是 `"::"`，解密必然失败。**Key 管理功能完全不可用。**

---

### C2. `crypto.ts` 解密函数同样返回硬编码空值

**文件:** `src/lib/crypto.ts` 第 158 行

```typescript
// maskKey() 返回硬编码:
return `...****`;  // ← 缺少 prefix 变量拼接
// 应该是: return `${prefix}...****`;
```

**影响:** Key 脱敏显示全部显示为 `...****`，无法区分不同 Key。

---

### C3. 多处模板字面量缺少变量插入（运行时行为异常）

以下位置使用了空模板字符串 `` `${}` `` 或 `` `...${}` `` ，变量未插入：

| 文件 | 行号 | 表达式 | 影响 |
|------|------|--------|------|
| `src/lib/crypto.ts` | 30 | `` `Got ${keyHex.length} characters.` `` → `` `Got  characters.` `` | 错误信息无实际长度 |
| `src/lib/crypto.ts` | 70 | `` `Key encryption failed: ${message}` `` → `` `Key encryption failed: ` `` | 错误原因丢失 |
| `src/lib/crypto.ts` | 114 | `` `Key decryption failed: ${message}` `` → `` `Key decryption failed: ` `` | 错误原因丢失 |
| `src/lib/env.ts` | 13 | `` `Missing required environment variables: ${missing.join(", ")}` `` → 变量丢失 | 启动时无法知道缺什么 |
| `src/lib/rate-limit.ts` | 46 | `` `token:${token}` `` → `` `token:` `` | 限流按空 token 分组，所有认证用户共享同一桶 |
| `src/lib/rate-limit.ts` | 49 | `` `ip:${ip}` `` → `` `ip:` `` | 限流按空 IP 分组，所有未认证用户共享同一桶 |
| `src/lib/api.ts` | 19 | `` `${API_BASE}${path}` `` → 空 URL | **前端所有 API 请求发送到无效地址** |
| `src/lib/api.ts` | 22 | `` `Bearer ${token}` `` → `` `Bearer ` `` | **Authorization 头始终为空 Bearer** |
| `src/lib/api.ts` | 52 | `` `Bearer ${newToken}` `` → 空 Token | 刷新后重试请求仍然无认证 |
| `src/lib/api.ts` | 70 | `` `API error: ${res.status}` `` → 错误码丢失 | 用户看不到 HTTP 状态码 |
| `src/lib/provider-tester.ts` | 69 | `` `Test failed: ${message}` `` → 空 | 测试失败原因不可见 |
| `src/lib/provider-tester.ts` | 79, 85 | URL 模板变量缺失 | **Provider 测试请求发往空 URL** |
| `src/lib/provider-tester.ts` | 107, 140, 181 | 消息模板变量缺失 | 成功/失败消息缺少关键数据 |
| `src/app/api/v1/dashboard/route.ts` | 73 | `` `${d.getFullYear()}-${...}` `` → `` `--` `` | **日期分组键全为 "--"**，成本趋势聚合失效 |

**根因分析:** 这看起来像是代码生成或模板转换过程中的系统性 bug —— 变量被从模板字面量中剥离了。

---

### C4. `.env` 文件包含硬编码的真实密钥

**文件:** `.env`

```
JWT_SECRET=6f2005d9cf3d650a0f271897506b7962ec59c943d6ad63a3a87c045a049e1838
KEY_ENCRYPTION_KEY=f3c9edf434d9cfd0b82c1b29d2b8c06edffd16f2f599627ef4fbc6463f32cdef
```

**影响:** 
- 虽然 `.gitignore` 包含了 `.env`，但该文件已存在于工作目录中
- 如果曾经被提交过 git 历史，密钥已永久泄露
- JWT_SECRET 和 KEY_ENCRYPTION_KEY 都是生产级真实密钥

---

### C5. 前端 API 客户端完全失效

**文件:** `src/lib/api.ts`

由于 C3 中描述的模板字面量问题：
- `fetchAPI()` 的 fetch URL 为空字符串
- Authorization header 始终为 `Bearer ` （空 token）
- **整个前端应用无法与后端通信**

---

### C6. Provider Key 测试功能完全失效

**文件:** `src/lib/provider-tester.ts`

由于 URL 和 header 模板变量缺失：
- `testOpenAIKey()` 发送请求到 `/v1/models`（无 baseUrl）
- Authorization header 为 `Bearer `（空 apiKey）
- **所有 Provider 连接测试都会失败**

---

### C7. Dashboard 日期聚合失效

**文件:** `src/app/api/v1/dashboard/route.ts` 第 72-74 行

```typescript
function dateKey(d: Date): string {
  return `--`;  // ← 应返回 "YYYY-MM-DD" 格式日期
}
```

**影响:** 成本趋势按日期分组的 key 全部为 `"--"`，趋势图表无法正常展示。

---

## 🟠 HIGH — 高危安全问题

### H1. Refresh Token 无服务端状态管理（Token 无法主动撤销）

**文件:** `src/app/api/v1/auth/refresh/route.ts`

- Refresh Token 签发后没有任何服务端存储
- 没有 token family / blacklist 机制
- 用户修改密码后旧 token 仍然有效
- 无法检测 token 重放攻击

**建议:** 将 refresh token hash 存入数据库，每次 rotation 时校验并替换。

---

### H2. 内存限流器 — 生产环境不可用

**文件:** `src/lib/rate-limit.ts`

```typescript
const requestCounts = new Map<string, RateLimitEntry>(); // 进程内存
```

**问题:**
- 多实例部署时每个实例独立计数，总限额 = 实例数 × 配置值
- 进程重启后所有计数归零
- 无自动清理机制（虽然定义了 `cleanupRateLimitStore()` 但从未被调用）
- 内存持续增长：过期条目不会被自动删除

**建议:** 生产环境使用 Redis + Sliding Window 算法。

---

### H3. 密码策略过弱

**文件:** `src/lib/validation.ts` 第 25 行, `src/app/api/v1/auth/register/route.ts` 第 44 行

```typescript
password: z.string().min(6, "Password must be at least 6 characters")
```

**问题:** 仅要求 6 位字符，无复杂度要求（大小写、数字、特殊字符）。

---

### H4. 注册/登录接口未使用 Zod Schema 校验

**文件:** 
- `src/app/api/v1/auth/login/route.ts`
- `src/app/api/v1/auth/register/route.ts`

两个接口都手动做 if-check 校验，而项目中已经定义了完整的 Zod schema (`loginSchema`, `registerSchema`) 但**从未被使用**。

**风险:** 校验逻辑不一致，容易遗漏字段。

---

### H5. Agent Token 无撤销机制

**文件:** `src/lib/auth.ts` 第 93-96 行

```typescript
export function generateAgentToken(userId: string): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "365d" });
}
```

- 365 天有效期
- `rotate-agent-token` 接口只签发新 token，不使旧 token 失效
- 一旦泄露，攻击者可长期使用

---

### H6. Telemetry 接口 eventType 未做强校验

**文件:** `src/app/api/v1/telemetry/batch/route.ts` 第 84 行

```typescript
eventType: e.eventType as any,  // 直接入库，未校验枚举值
```

虽然 `telemetryEventSchema` 定义了合法枚举，但 route handler 并**没有调用 validate()**。

---

### H7. CORS 开发模式允许任意来源

**文件:** `src/middleware.ts` 第 22-25 行

```typescript
if (NODE_ENV !== "production") {
  return "*";  // 开发环境通配符
}
```

如果 `NODE_ENV` 意外未设置为 `production`（如 Docker 容器忘记设置），则生产环境也会允许任意跨域。

---

### H8. Prisma Datasource 缺少 URL 配置

**文件:** `prisma/schema.prisma` 第 11-13 行

```prisma
datasource db {
  provider = "postgresql"
  // 缺少 url = env("DATABASE_URL")
}
```

Prisma 7 可能支持隐式环境变量，但这在文档中不明确，可能导致连接失败。

---

## 🟡 MEDIUM — 中等质量问题

### M1. Next.js 使用 Canary 版本

**文件:** `package.json` 第 37 行

```json
"next": "^16.3.0-canary.59"
```

Canary 版本不应出现在生产依赖中。可能有 breaking changes 或不稳定行为。

---

### M2. Agents POST 接口输入未使用 Schema �