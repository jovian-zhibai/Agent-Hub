# 🛠️ Developer Guide

欢迎！这份指南将帮助你快速上手 Agent Hub 的开发。

---

## 🚀 快速开始（5分钟）

### 1. 环境准备

**必需软件**：
- Node.js 18+ （推荐 20）
- PostgreSQL 14+（或 Docker）
- Git

**可选软件**：
- Docker & Docker Compose
- VS Code + 推荐扩展

### 2. 克隆并设置

```bash
# 克隆仓库
git clone https://github.com/YOUR_USERNAME/agent-hub.git
cd agent-hub

# 一键设置（安装依赖 + 配置数据库 + 生成密钥）
npm run setup

# 启动开发服务器
npm run dev
```

打开 http://localhost:3000 🎉

---

## 📁 项目结构详解

```
agent-hub/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (auth)/            # 未认证页面组
│   │   ├── (dashboard)/       # 已认证页面组
│   │   ├── api/               # API 路由
│   │   │   └── v1/            # API 版本 1
│   │   │       ├── auth/      # 认证端点
│   │   │       ├── agents/    # Agent CRUD
│   │   │       ├── keys/      # Key 管理
│   │   │       └── telemetry/ # 遥测数据
│   │   ├── layout.tsx         # 根布局
│   │   └── page.tsx           # 首页
│   │
│   ├── components/            # React 组件
│   │   ├── ui/               # 基础 UI 组件
│   │   ├── dashboard/        # Dashboard 特定组件
│   │   └── forms/            # 表单组件
│   │
│   ├── lib/                   # 工具函数和核心逻辑
│   │   ├── auth.ts           # 认证工具
│   │   ├── crypto.ts         # 🔐 加密/解密
│   │   ├── validation.ts     # ✅ Zod schemas
│   │   ├── rate-limit.ts     # 🚦 Rate limiting
│   │   ├── provider-tester.ts # 🧪 Provider 测试
│   │   ├── prisma.ts         # Prisma client
│   │   └── __tests__/        # 单元测试
│   │
│   └── hooks/                 # React hooks
│       ├── useDashboard.ts
│       └── useAuth.ts
│
├── packages/
│   ├── cli/                   # CLI 工具
│   │   ├── src/
│   │   │   ├── commands/     # CLI 命令
│   │   │   └── utils/        # CLI 工具
│   │   └── package.json
│   │
│   └── sdk/                   # TypeScript SDK
│       └── src/
│           ├── key-manager.ts
│           ├── permission-checker.ts
│           └── data-reporter.ts
│
├── prisma/
│   ├── schema.prisma         # 数据库模型定义
│   ├── migrations/           # 迁移历史
│   └── seed.ts              # 种子数据
│
├── scripts/
│   ├── setup.mjs            # 初始化脚本
│   ├── dev.mjs              # 开发服务器管理
│   ├── db-backup.sh         # 数据库备份
│   └── db-restore.sh        # 数据库恢复
│
├── docs/
│   ├── ARCHITECTURE.md       # 架构文档
│   └── DEPLOYMENT.md        # 部署指南
│
└── tests/                    # 端到端测试（待添加）
```

---

## 🧪 测试开发流程

### 运行测试

```bash
# 运行所有测试
npm test

# 监听模式（开发时推荐）
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# 类型检查
npm run type-check

# Lint
npm run lint
```

### 编写测试

**单元测试示例**：

```typescript
// src/lib/__tests__/my-function.test.ts
import { describe, it, expect } from 'vitest';
import { myFunction } from '../my-function';

describe('myFunction', () => {
  it('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected');
  });
});
```

**API 测试示例**：

```typescript
import { createMockRequest } from './test-helpers';

it('should return 200', async () => {
  const request = createMockRequest('GET', '/api/v1/test');
  const response = await GET(request);
  expect(response.status).toBe(200);
});
```

---

## 🗄️ 数据库开发

### Prisma 常用命令

```bash
# 可视化数据库
npx prisma studio

# 创建新迁移
npx prisma migrate dev --name add_new_field

# 应用迁移（生产）
npx prisma migrate deploy

# 重置数据库（开发）
npx prisma migrate reset

# 生成 Prisma Client
npx prisma generate

# 格式化 schema
npx prisma format
```

### 修改数据库 Schema

1. 编辑 `prisma/schema.prisma`
2. 运行 `npx prisma migrate dev --name your_change`
3. Prisma 自动生成迁移和 TypeScript 类型

**示例**：添加新字段

```prisma
model Agent {
  id          String   @id @default(uuid())
  name        String
  // 添加新字段
  description String?  @db.VarChar(500)
}
```

---

## 🔐 安全开发规范

### 1. API Key 处理

```typescript
// ❌ 错误：直接存储明文
await prisma.key.create({ 
  data: { keyValue: plainKey } 
});

// ✅ 正确：使用加密
import { encryptKey } from '@/lib/crypto';
await prisma.key.create({ 
  data: { keyEncrypted: encryptKey(plainKey) } 
});
```

### 2. 输入验证

```typescript
// ❌ 错误：直接使用请求数据
const { email } = await request.json();

// ✅ 正确：使用 Zod 验证
import { validate, loginSchema } from '@/lib/validation';
const data = validate(loginSchema, await request.json());
```

### 3. Rate Limiting

```typescript
// ✅ 敏感端点必须添加 Rate Limiting
import { rateLimit, RateLimitPresets } from '@/lib/rate-limit';

const limiter = rateLimit(RateLimitPresets.strict);

export async function POST(request: NextRequest) {
  const limitResult = await limiter(request);
  if (limitResult) return limitResult;
  
  // 处理请求...
}
```

### 4. 错误处理

```typescript
// ✅ 统一的错误响应格式
try {
  // 业务逻辑
} catch (error) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { code: error.name, message: error.message },
      { status: error.statusCode }
    );
  }
  
  console.error('[route] Unexpected error:', error);
  return NextResponse.json(
    { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    { status: 500 }
  );
}
```

---

## 🎯 开发最佳实践

### 代码风格

```typescript
// ✅ 使用有意义的变量名
const activeKeyBinding = await findActiveBinding(agentId);

// ✅ 添加 JSDoc 注释
/**
 * Encrypt an API key using AES-256-GCM.
 * @param plaintext - The API key to encrypt
 * @returns Encrypted string in format "iv:ciphertext:authTag"
 */
export function encryptKey(plaintext: string): string {
  // ...
}

// ✅ 使用 TypeScript 类型
interface KeyBinding {
  keyId: string;
  priority: number;
  status: 'active' | 'standby';
}

// ✅ 提取常量
const MAX_RETRY_ATTEMPTS = 3;
const TIMEOUT_MS = 10000;
```

### 组件开发

```tsx
// ✅ 使用 TypeScript 定义 props
interface ButtonProps {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export function Button({ 
  label, 
  onClick, 
  variant = 'primary',
  disabled = false 
}: ButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`btn btn-${variant}`}
    >
      {label}
    </button>
  );
}
```

### API 开发

```typescript
// ✅ 统一的 API 路由结构
// src/app/api/v1/resource/route.ts

export async function GET(request: NextRequest) {
  // 1. Rate limiting
  // 2. Authentication
  // 3. Input validation
  // 4. Business logic
  // 5. Return response
}

export async function POST(request: NextRequest) {
  // 同上
}
```

---

## 🔧 常见开发任务

### 添加新的 API 端点

1. **创建路由文件**
   ```bash
   touch src/app/api/v1/my-resource/route.ts
   ```

2. **实现处理函数**
   ```typescript
   export async function GET(request: NextRequest) {
     const limiter = rateLimit(RateLimitPresets.standard);
     const limitResult = await limiter(request);
     if (limitResult) return limitResult;
     
     const user = await getAuthUser(request);
     // 业务逻辑...
     
     return NextResponse.json({ data: result });
   }
   ```

3. **添加测试**
   ```typescript
   // src/app/api/v1/my-resource/route.test.ts
   ```

### 添加新的数据库模型

1. **编辑 Schema**
   ```prisma
   model NewModel {
     id        String   @id @default(uuid())
     name      String
     createdAt DateTime @default(now())
     
     @@map("new_models")
   }
   ```

2. **创建迁移**
   ```bash
   npx prisma migrate dev --name add_new_model
   ```

3. **更新 Zod Schema**
   ```typescript
   // src/lib/validation.ts
   export const createNewModelSchema = z.object({
     name: z.string().min(1),
   });
   ```

### 添加新的 Provider

1. **更新数据库** - 在 `prisma/seed.ts` 添加 Provider 数据

2. **添加测试函数** - 在 `src/lib/provider-tester.ts`
   ```typescript
   async function testNewProvider(apiKey: string): Promise<TestResult> {
     // 实现测试逻辑
   }
   ```

3. **更新路由** - 在 Provider 测试逻辑中添加新 case

---

## 🐛 调试技巧

### 使用 VS Code 调试

创建 `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Next.js: debug server-side",
      "type": "node-terminal",
      "request": "launch",
      "command": "npm run dev"
    }
  ]
}
```

### 查看数据库内容

```bash
# Prisma Studio（推荐）
npx prisma studio

# 或使用 psql
psql $DATABASE_URL
```

### 日志调试

```typescript
// 开发环境详细日志
if (process.env.NODE_ENV === 'development') {
  console.log('Debug:', { variable1, variable2 });
}

// 使用 console.error 记录错误
console.error('[module] Error occurred:', error);
```

---

## 📦 打包和部署

### 本地构建测试

```bash
# 构建生产版本
npm run build

# 启动生产服务器
npm start
```

### Docker 构建

```bash
# 构建镜像
docker build -t agent-hub:latest .

# 运行容器
docker run -p 3000:3000 \
  -e DATABASE_URL="..." \
  -e JWT_SECRET="..." \
  -e KEY_ENCRYPTION_KEY="..." \
  agent-hub:latest
```

---

## 🤝 贡献流程

### 1. Fork 和 Clone

```bash
# Fork on GitHub, then:
git clone https://github.com/YOUR_USERNAME/agent-hub.git
cd agent-hub
git remote add upstream https://github.com/ORIGINAL/agent-hub.git
```

### 2. 创建分支

```bash
git checkout -b feature/my-awesome-feature
```

### 3. 开发和测试

```bash
# 编写代码...
npm test
npm run lint
npm run type-check
```

### 4. 提交

```bash
git add .
git commit -m "feat: add awesome feature"
```

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：
- `feat:` 新功能
- `fix:` Bug 修复
- `docs:` 文档变更
- `test:` 测试相关
- `refactor:` 代码重构

### 5. 推送和创建 PR

```bash
git push origin feature/my-awesome-feature
```

然后在 GitHub 上创建 Pull Request。

---

## 🎓 学习资源

### 项目相关
- [Next.js 文档](https://nextjs.org/docs)
- [Prisma 文档](https://www.prisma.io/docs)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Vitest](https://vitest.dev/)

### 最佳实践
- [TypeScript 深入](https://www.typescriptlang.org/docs/)
- [React 模式](https://react.dev/learn)
- [API 设计](https://restfulapi.net/)

---

## 💬 获取帮助

遇到问题？

1. **搜索现有 Issues** - 可能已有解决方案
2. **查阅文档** - README, ARCHITECTURE, DEPLOYMENT
3. **创建 Issue** - 详细描述问题
4. **Discord/Slack** - 实时讨论

---

## ✅ 开发检查清单

新功能开发完成前的检查：

- [ ] 代码遵循项目规范
- [ ] 添加了必要的测试
- [ ] 测试全部通过
- [ ] TypeScript 编译无错误
- [ ] ESLint 无警告
- [ ] 更新了相关文档
- [ ] 提交信息清晰
- [ ] 没有提交敏感信息

---

**快乐编码！** 🚀

如有问题，随时提 Issue 或 PR！
