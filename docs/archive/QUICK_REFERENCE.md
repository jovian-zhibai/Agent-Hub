# 🚀 Agent Hub - 快速参考

## 一句话总结
**Agent Hub 是一个 AI Agent 管理平台，帮助你管理多个 API Key、控制权限、监控成本。**

---

## 🎯 核心功能

```
🔑 多 Key 管理      → 自动 failover，永不断线
🛡️ 权限控制        → 精细控制 Agent 可以做什么
📊 成本监控        → 实时追踪 Token 使用和花费
🖥️ Web Dashboard  → 一目了然的管理界面
💻 CLI 工具        → agent-hub connect 一键连接
```

---

## ⚡ 5 分钟快速开始

```bash
# 1. 克隆并设置
git clone https://github.com/YOUR_USERNAME/agent-hub.git
cd agent-hub
npm run setup

# 2. 启动
npm run dev

# 3. 打开浏览器
open http://localhost:3000

# 4. 连接 Agent
agent-hub connect
```

---

## 📁 项目结构速查

```
agent-hub/
├── src/
│   ├── app/              # Next.js 页面和 API
│   │   ├── api/v1/       # RESTful API
│   │   ├── agents/       # Agent 管理页面
│   │   └── keys/         # Key 管理页面
│   ├── components/       # React 组件
│   └── lib/              # 工具函数
│       ├── crypto.ts     # 🔐 加密
│       ├── validation.ts # ✅ 验证
│       ├── rate-limit.ts # 🚦 限流
│       └── provider-tester.ts # 🧪 测试
├── packages/
│   ├── cli/              # CLI 工具
│   └── sdk/              # TypeScript SDK
├── prisma/
│   └── schema.prisma     # 数据库模型
└── docs/                 # 完整文档
```

---

## 🧪 测试速查

```bash
npm test              # 运行所有测试 (41 tests ✅)
npm run test:watch    # 监听模式
npm run test:coverage # 覆盖率报告 (~35%)
npm run type-check    # TypeScript 类型检查
npm run lint          # 代码检查
```

---

## 📚 关键文档

| 文档 | 用途 | 链接 |
|------|------|------|
| **README** | 项目介绍、快速开始 | [README.md](./README.md) |
| **贡献指南** | 如何参与贡献 | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| **部署指南** | 生产部署教程 | [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) |
| **架构文档** | 技术架构详解 | [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) |
| **安全政策** | 漏洞报告流程 | [SECURITY.md](./SECURITY.md) |

---

## 🔐 安全特性

```
✅ AES-256-GCM     → 所有 Key 加密存储
✅ JWT 认证        → 无状态身份验证
✅ Rate Limiting   → 防止 API 滥用
✅ Zod 验证        → 所有输入严格验证
✅ 真实 API 测试   → 验证 Key 有效性
```

---

## 🛠️ 开发命令

```bash
# 开发
npm run dev          # 启动开发服务器
npm run build        # 构建生产版本
npm start            # 启动生产服务器

# 数据库
npx prisma studio    # 数据库可视化
npx prisma migrate dev # 创建迁移
npx prisma generate  # 生成 Prisma Client

# Docker
docker compose up -d        # 启动所有服务
docker compose logs -f app  # 查看日志
docker compose down         # 停止服务
```

---

## 🚀 API 速查

### 认证
```bash
POST /api/v1/auth/register  # 注册
POST /api/v1/auth/login     # 登录
POST /api/v1/auth/refresh   # 刷新 Token
```

### Agent 管理
```bash
GET    /api/v1/agents       # 列出所有 Agent
POST   /api/v1/agents       # 创建 Agent
GET    /api/v1/agents/:id   # 获取 Agent 详情
PATCH  /api/v1/agents/:id   # 更新 Agent
DELETE /api/v1/agents/:id   # 删除 Agent
```

### Key 管理
```bash
GET    /api/v1/keys         # 列出所有 Key
POST   /api/v1/keys         # 添加 Key
GET    /api/v1/keys/:id     # 获取 Key 详情
POST   /api/v1/keys/:id/test # 测试 Key
PATCH  /api/v1/keys/:id     # 更新 Key
DELETE /api/v1/keys/:id     # 删除 Key
```

---

## 🐳 Docker 快速参考

```bash
# 仅数据库（推荐本地开发）
docker compose up -d postgres

# 包含应用（生产部署）
docker compose --profile production up -d

# 查看日志
docker compose logs -f

# 重启服务
docker compose restart

# 清理
docker compose down -v  # -v 删除数据卷
```

---

## 🔧 环境变量

```bash
# 必需
DATABASE_URL="postgresql://user:pass@localhost:5432/db"
JWT_SECRET="<32-byte-hex>"            # 运行 setup 自动生成
KEY_ENCRYPTION_KEY="<32-byte-hex>"    # 运行 setup 自动生成

# 可选
NEXT_PUBLIC_API_URL="http://localhost:3000/api"
REDIS_URL="redis://localhost:6379"   # 未来使用
```

---

## 📊 项目状态

```
✅ 核心功能: 完整
✅ 安全性:   生产级
✅ 文档:     专业级
✅ CI/CD:    完整
🟡 测试:     35% (目标 70%)
🟡 性能:     待优化
```

---

## 🎯 常见任务

### 添加新的 Provider
1. 更新 `prisma/schema.prisma` Provider 数据
2. 在 `provider-tester.ts` 添加测试函数
3. 运行 `npx prisma migrate dev`

### 添加新的 API 端点
1. 在 `src/app/api/v1/` 创建路由文件
2. 使用 Rate Limiting: `rateLimit(RateLimitPresets.standard)`
3. 使用 Zod 验证: `validate(schema, data)`
4. 添加测试

### 修改数据库 Schema
```bash
# 1. 编辑 prisma/schema.prisma
# 2. 创建迁移
npx prisma migrate dev --name your_change_name
# 3. 生成 Client
npx prisma generate
```

---

## 🐛 常见问题

**Q: 数据库连接失败？**
```bash
# 检查 PostgreSQL 是否运行
docker compose up -d postgres
# 或
brew services start postgresql
```

**Q: 测试失败？**
```bash
# 确保环境变量设置正确
npm run setup
# 重新运行测试
npm test
```

**Q: Rate Limit 被触发？**
```bash
# 开发环境可以跳过
request.headers.set('x-skip', 'true')
# 或等待时间窗口重置
```

---

## 📞 获取帮助

```
🐛 Bug 报告      → GitHub Issues
💡 功能建议      → GitHub Discussions
💬 社区交流      → Discord/Slack
📧 安全问题      → security@agent-hub.dev
```

---

## 🎉 下一步

1. ⭐ **Star on GitHub**
2. 📖 **阅读完整文档** → [README.md](./README.md)
3. 🚀 **部署到生产** → [DEPLOYMENT.md](./docs/DEPLOYMENT.md)
4. 🤝 **参与贡献** → [CONTRIBUTING.md](./CONTRIBUTING.md)
5. 🔒 **了解安全** → [SECURITY.md](./SECURITY.md)

---

**快速链接**: [GitHub](https://github.com/YOUR_USERNAME/agent-hub) · [文档](./README.md) · [问题](https://github.com/YOUR_USERNAME/agent-hub/issues) · [讨论](https://github.com/YOUR_USERNAME/agent-hub/discussions)

**版本**: v1.0.0-beta.1 · **更新**: 2026-06-20 · **License**: MIT
