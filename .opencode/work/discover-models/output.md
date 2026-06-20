# Discover Models 端点 — 完成报告

## 文件
`src/app/api/v1/keys/[id]/discover-models/route.ts` — 493 行

## 路由
**POST** `/api/v1/keys/{id}/discover-models`

## 实现内容

### 第1步：鉴权与 Key 验证
- `getAuthUser(request)` 解析 JWT
- `prisma.key.findUnique` 校验 key 存在且属于当前用户 (accountId === user.id)
- 加载 `provider` 信息 (name, supportedProtocols, baseUrls)
- 解析 `keyEncrypted`：以 `hash_` 开头则 strip 前缀取明文，否则原样使用

### 第2步：获取模型列表（双策略）

| 策略 | 适用 Provider | 实现 |
|------|--------------|------|
| **A** | OpenAI / DeepSeek / Google 等 | `GET {base_url}/models`，Bearer token 认证，解析 `{ data: [{ id }] }` |
| **B** | Anthropic | 硬编码已知模型列表（Anthropic 无 `/v1/models` 端点） |

### 第3步：定价匹配（三级流水线）

```
normalizeModelName(rawName)
  → matchFromDatabase()        // providerId + modelName 命中且 pricingSource ≠ "unknown"
    → matchFromLiteLLM()        // BerriAI/litellm GitHub JSON
      → matchFromOpenRouter()   // openrouter.ai/api/v1/models
```

- **normalizeModelName**：去日期后缀 (`-20250514`, `-2025-04-09`, `-0619`)、转小写
- **LiteLLM**：模糊匹配（key includes modelName 或反之），`cost_per_token * 1_000_000` 转每 1M tokens
- **OpenRouter**：同上模糊匹配 + 单位转换
- **全部未命中**：`pricingSource = "unknown"`, pricing 写 0

### 第4步：写入与响应
- `prisma.model.upsert` 按 `(providerId, modelName)` 复合唯一键去重
- 返回 `{ models, matched, unmatched, total }`

### 超时与容错
- 所有外部请求统一使用 `fetchWithTimeout(5s)` — `AbortController`
- 外部 API 失败/超时 → 空结果返回（不抛给用户）
- 部分模型匹配成功也算成功（partial results）

### 响应格式
```json
{
  "models": [
    {
      "modelName": "claude-sonnet-4",
      "displayName": "Claude Sonnet 4",
      "pricingInput": 3.0,
      "pricingOutput": 15.0,
      "pricingSource": "litellm",
      "protocol": "openai"
    }
  ],
  "matched": 1,
  "unmatched": 0,
  "total": 1
}
```

## 函数拆分

| 函数 | 行数 | 职责 |
|------|------|------|
| `POST` | 221 | 主 handler：鉴权 → 发现 → 匹配 → 写入 |
| `normalizeModelName` | 14 | 模型名规范化（日期后缀剥离） |
| `toDisplayName` | 6 | 模型名 → 可读 displayName |
| `fetchWithTimeout` | 16 | 5s 超时的 fetch 封装 |
| `fetchModelsFromProvider` | 41 | Strategy A：调供应商 `/v1/models` |
| `getAnthropicModels` | 6 | Strategy B：Anthropic 硬编码列表 |
| `matchFromDatabase` | 28 | 本地 models 表匹配 |
| `matchFromLiteLLM` | 52 | LiteLLM GitHub JSON 匹配 |
| `matchFromOpenRouter` | 38 | OpenRouter API 匹配 |

## 构建状态
`npm run build` ✅ 编译通过，路由已注册为 `ƒ /api/v1/keys/[id]/discover-models`