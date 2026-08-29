#!/usr/bin/env node
/**
 * Agent Hub Seed Script — 一次性建库行 + 签 token + 写 config
 *
 * 绕过 connect CLI（交互式、未实测），直接：
 *   1. 建 Account（如不存在）
 *   2. 建 Agent（如不存在）
 *   3. 签 agentToken（365天，type=agent）
 *   4. 写 ~/.agent-hub/config.json
 *
 * 用法：node scripts/seed-agent.mjs
 * 幂等：重复跑不会重复建，会更新 token。
 */

import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { LocalCache } from "../packages/sdk/src/local-cache";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

// ── 配置 ──────────────────────────────────────

// 从 .env 读 JWT_SECRET（Next.js 不会自动加载 .env 到普通 Node 脚本）
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    console.error("❌ .env 不存在，请先在项目根目录创建 .env（含 JWT_SECRET）");
    process.exit(1);
  }
  const content = fs.readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match) {
      const [, key, value] = match;
      // 去掉首尾引号
      process.env[key] = value.replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error("❌ JWT_SECRET 未配置，请在 .env 中设置");
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ── 常量 ──────────────────────────────────────

const ACCOUNT_EMAIL = "local@opc-agents.dev";
const ACCOUNT_NAME = "OPC Agents (Local)";
const AGENT_NAME = "opc-director";
const AGENT_FRAMEWORK = "opencode";
const PROJECT_NAME = "opc-agents";
const PROJECT_PATH = "/Users/souljian/code/opc/opc-agents";

const CONFIG_DIR = path.join(os.homedir(), ".agent-hub");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

// ── 主流程 ────────────────────────────────────

async function main() {
  console.log("🚀 Agent Hub Seed 脚本启动\n");

  // 1. 建/取 Account
  console.log("📋 步骤 1: 确保 Account 存在...");
  let account = await prisma.account.findUnique({
    where: { email: ACCOUNT_EMAIL },
  });

  if (!account) {
    // 生成随机密码 hash（不需要密码登录，只占字段）
    const randomPassword = randomUUID();
    const passwordHash = await bcrypt.hash(randomPassword, 12);

    account = await prisma.account.create({
      data: {
        email: ACCOUNT_EMAIL,
        name: ACCOUNT_NAME,
        plan: "free",
        passwordHash,
        tokenVersion: 0,
      },
    });
    console.log(`   ✅ 新建 Account: ${account.email} (id=${account.id.slice(0, 8)}...)`);
  } else {
    console.log(`   ✅ 已存在 Account: ${account.email} (id=${account.id.slice(0, 8)}...)`);
  }

  // 2. 建/取 Agent
  console.log("\n📋 步骤 2: 确保 Agent 存在...");
  const machineId = `${os.hostname()}-${randomUUID().slice(0, 8)}`;

  let agent = await prisma.agent.findFirst({
    where: {
      accountId: account.id,
      name: AGENT_NAME,
    },
  });

  if (!agent) {
    agent = await prisma.agent.create({
      data: {
        accountId: account.id,
        name: AGENT_NAME,
        description: "OPC Agents Director — 五运行时统一调度",
        framework: AGENT_FRAMEWORK,
        status: "running",
        machineId,
        safetyMode: false,
        enabled: true,
        projectName: PROJECT_NAME,
        projectPath: PROJECT_PATH,
      },
    });
    console.log(`   ✅ 新建 Agent: ${agent.name} (id=${agent.id.slice(0, 8)}...)`);
  } else {
    console.log(`   ✅ 已存在 Agent: ${agent.name} (id=${agent.id.slice(0, 8)}...)`);
  }

  // 3. 签 agentToken（365天，type=agent）
  console.log("\n📋 步骤 3: 签发 agentToken...");
  const agentToken = jwt.sign(
    {
      userId: account.id,
      type: "agent",
      agentId: agent.id,
      tokenVersion: account.tokenVersion,
    },
    JWT_SECRET,
    { expiresIn: "365d" },
  );
  console.log(`   ✅ agentToken 已签发（365天有效，前缀: ${agentToken.slice(0, 20)}...）`);

  // 同时签一个 accessToken（2小时，给 CLI/API 用）
  const accessToken = jwt.sign(
    {
      userId: account.id,
      email: account.email,
      type: "access",
      tokenVersion: account.tokenVersion,
    },
    JWT_SECRET,
    { expiresIn: "2h" },
  );

  // 4. 写 config.json（用 LocalCache.set 包装 CacheEntry，与插件读取逻辑对齐）
  console.log("\n📋 步骤 4: 写 ~/.agent-hub/config.json...");

  const cache = new LocalCache(CONFIG_DIR);
  await cache.set("config", {
    apiBaseUrl: "http://localhost:3000",
    authToken: agentToken,   // 用 365 天 agent token（type=agent），不是 2h accessToken
    agentId: agent.id,
    agentName: agent.name,
    machineId: agent.machineId || machineId,
  });

  console.log(`   ✅ config.json 已写入（CacheEntry 包装，authToken=agentToken 365天）: ${CONFIG_PATH}`);

  // ── 验证 ──────────────────────────────────
  console.log("\n🔍 验证...");

  // 验证 token 能被解析
  try {
    const decoded = jwt.verify(agentToken, JWT_SECRET);
    console.log(`   ✅ agentToken 解析成功: type=${decoded.type}, agentId=${decoded.agentId?.slice(0, 8)}...`);
  } catch (err) {
    console.error(`   ❌ agentToken 解析失败: ${err.message}`);
    process.exit(1);
  }

  // 验证 Agent 在库里
  const agentCount = await prisma.agent.count({ where: { id: agent.id } });
  console.log(`   ✅ Agent 库记录: ${agentCount} 条`);

  // 验证 Account 在库里
  const accountCount = await prisma.account.count({ where: { id: account.id } });
  console.log(`   ✅ Account 库记录: ${accountCount} 条`);

  // 验证 config 能被 LocalCache 读到（插件用同样的方式读）
  const readback = await cache.get<{ authToken: string; agentId: string }>("config");
  if (!readback) {
    console.error("   ❌ config 读回失败（LocalCache.get 返回 null）—— 插件将读不到配置");
    process.exit(1);
  }
  if (readback.agentId !== agent.id) {
    console.error(`   ❌ config agentId 不匹配: 期望 ${agent.id}, 实际 ${readback.agentId}`);
    process.exit(1);
  }
  // 验证 authToken 是 agent token（type=agent），不是 access token
  try {
    const decoded = jwt.verify(readback.authToken, JWT_SECRET) as { type: string };
    if (decoded.type !== "agent") {
      console.error(`   ❌ config authToken 类型错误: 期望 agent, 实际 ${decoded.type}`);
      process.exit(1);
    }
    console.log(`   ✅ config 读回成功: authToken type=agent, agentId=${readback.agentId.slice(0, 8)}...`);
  } catch (err) {
    console.error(`   ❌ config authToken 解析失败: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log("\n🎉 Seed 完成！");
  console.log(`   Account: ${account.email}`);
  console.log(`   Agent:   ${agent.name} (id=${agent.id})`);
  console.log(`   Config:  ${CONFIG_PATH}`);
  console.log(`   API:     http://localhost:3000`);
  console.log("\n   下一步: 0.8 改 opencode.json 引用插件");
}

main()
  .catch((err) => {
    console.error("\n❌ Seed 失败:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
