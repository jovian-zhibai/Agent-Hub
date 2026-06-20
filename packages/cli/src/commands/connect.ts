// ──────────────────────────────────────────────
// Agent Hub CLI — connect 命令
// 扫描本地 Agent → 登录/注册 → 注册 Agent → 保存配置
// ──────────────────────────────────────────────

import { Command } from "commander";
import * as readline from "node:readline/promises";
import { stdout as output, stdin as input } from "node:process";
import { randomUUID } from "node:crypto";
import * as os from "node:os";
import { ApiClient } from "../utils/api.js";
import {
  readConfig,
  writeConfig,
  isConnected,
  type AgentHubConfig,
} from "../utils/config.js";
import { scanEnvironment, scanKeys, type DiscoveredAgent } from "../utils/scanner.js";

// ──────────────────────────────────────────────
// Command definition
// ──────────────────────────────────────────────

export function createConnectCommand(program: Command): void {
  program
    .command("connect")
    .description("扫描本地 Agent 并连接到 Agent Hub")
    .option("-e, --email <email>", "登录邮箱（非交互模式）")
    .option("-p, --password <password>", "登录密码（非交互模式）")
    .option("--register", "注册新账号")
    .option("--non-interactive", "非交互模式（使用已有 token 重新扫描注册）")
    .option("--api-url <url>", "后端 API 地址")
    .action(handleConnect);
}

// ──────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────

async function handleConnect(options: {
  email?: string;
  password?: string;
  register?: boolean;
  apiUrl?: string;
  nonInteractive?: boolean;
}): Promise<void> {
  try {
    // ── Step 1: Check existing connection ──────────
    const config = await readConfig();
    if (await isConnected() && !options.nonInteractive) {
      console.log(`✅ 已连接 Agent Hub（${config.agentName ?? "unknown"}）`);
      console.log(`   如需重新连接，请先删除 ~/.agent-hub/config.json`);
      process.exit(0);
    }

    // ── Step 2: Ensure authenticated ───────────────
    // config.json 不存在时，先引导用户登录再继续
    const apiUrl = options.apiUrl ?? config.apiBaseUrl;
    const apiClient = new ApiClient(apiUrl);

    const auth = await ensureAuthenticated(apiClient, options);
    const { authToken, agentId, agentName } = auth;

    console.log(`✅ 认证成功：${agentName}`);

    // ── Step 3: Scan local environment ──────────────
    console.log("🔍 扫描本地 Agent 环境...");
    const scanResult = await scanEnvironment();

    if (scanResult.agents.length === 0) {
      console.log("⚠️  未发现任何 Agent 配置");
      console.log("   扫描路径：");
      console.log("     • .opencode/agents/*.md");
      console.log("     • opencode.json");
      console.log("     • .claude/opencode.json");
      console.log("     • .agent-hub.yml");
      console.log("");
      console.log("   请确保在项目根目录下运行此命令。");
      process.exit(1);
    }

    console.log(`📋 发现 ${scanResult.agents.length} 个 Agent：`);
    for (const agent of scanResult.agents) {
      const typeLabel = {
        opencode: "OPC Agent",
        claude: "Claude",
        manual: "Manual",
      }[agent.type];
      console.log(`   • ${agent.name} (${typeLabel}) — ${agent.sourcePath}`);
    }

    // ── Step 4: Register discovered agents ──────────
    const machineId = generateMachineId();
    const registeredAgents: DiscoveredAgent[] = [];

    for (const agent of scanResult.agents) {
      try {
        console.log(`   📝 注册 Agent「${agent.name}」...`);
        await apiClient.registerAgent(authToken, {
          name: agent.name,
          type: agent.type,
          machineId,
          projectName: agent.projectName,
          projectPath: agent.projectPath,
        });
        registeredAgents.push(agent);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`   ❌ Agent「${agent.name}」注册失败: ${message}`);
      }
    }

    // ── Step 5: Save config ─────────────────────────
    const newConfig: AgentHubConfig = {
      apiBaseUrl: apiUrl,
      authToken,
      agentToken: auth.agentToken,
      agentId,
      agentName,
      machineId,
    };
    await writeConfig(newConfig);

    // ── Step 6: Scan and register API Keys ───────────
    const projectRoot = scanResult.projectRoot;
    if (projectRoot) {
      const scannedKeys = scanKeys(projectRoot);
      if (scannedKeys.length > 0) {
        console.log(`\n🔑 扫描到 ${scannedKeys.length} 个 API Key：`);
        for (const key of scannedKeys) {
          try {
            const keyResult = await apiClient.registerKey(authToken, {
              providerId: key.providerId,
              protocol: key.protocol,
              keyLabel: key.keyLabel,
              keyEncrypted: key.keyEncrypted,
              scope: "personal",
            });
            if (keyResult) {
              console.log(`   ✅ ${key.keyLabel}: ${key.keyEncrypted.slice(0, 8)}...`);
            } else {
              console.log(`   ⚠️  ${key.keyLabel}: 注册失败（可能已存在）`);
            }
          } catch {
            console.log(`   ⚠️  ${key.keyLabel}: 注册异常`);
          }
        }
      }
    }

    // ── Step 7: Output ──────────────────────────────
    const count = registeredAgents.length;
    console.log(`\n✅ 已连接 ${count} 个 Agent`);

    if (count > 0) {
      console.log(`   配置文件：~/.agent-hub/config.json`);
      console.log(`   运行 \`agent-hub sync\` 同步配置`);
    }

    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ 连接失败: ${message}`);
    process.exit(1);
  }
}

/**
 * 确保用户已认证。
 * 如果本地 config.json 中没有 token，先引导用户登录或注册。
 */
async function ensureAuthenticated(
  apiClient: ApiClient,
  options: { email?: string; password?: string; register?: boolean },
): Promise<{ authToken: string; agentId: string; agentName: string; agentToken?: string }> {
  // 检查已有 token
  const existingConfig = await readConfig();
  if (existingConfig.authToken) {
    return {
      authToken: existingConfig.authToken,
      agentId: existingConfig.agentId ?? "",
      agentName: existingConfig.agentName ?? "",
      agentToken: existingConfig.agentToken,
    };
  }

  // 非交互式：通过 --email/--password 参数登录
  if (options.email && options.password) {
    console.log(`\n🔑 正在${options.register ? "注册" : "登录"}...`);
    const authResult = options.register
      ? await apiClient.register(options.email, options.password)
      : await apiClient.login(options.email, options.password);
    return normalizeAuthResult(authResult);
  }

  // 交互式：提示用户输入
  console.log("\n🔐 请先登录 Agent Hub");
  const rl = readline.createInterface({ input, output });

  try {
    const action = options.register ? "register" : await promptAction(rl);
    const email = await promptEmail(rl);
    const password = await promptPassword(rl);

    console.log(`\n🔑 正在${action === "register" ? "注册" : "登录"}...`);

    const authResult =
      action === "register"
        ? await apiClient.register(email, password)
        : await apiClient.login(email, password);

    return normalizeAuthResult(authResult);
  } finally {
    rl.close();
  }
}

/**
 * Normalize AuthResponse to match ensureAuthenticated's return type.
 * AuthResponse uses `token`, but the rest of the code expects `authToken`.
 */
function normalizeAuthResult(
  authResult: import("../utils/api.js").AuthResponse,
): { authToken: string; agentId: string; agentName: string; agentToken?: string } {
  return {
    authToken: authResult.token,
    agentId: authResult.agentId,
    agentName: authResult.agentName,
    agentToken: authResult.agentToken,
  };
}

// ──────────────────────────────────────────────
// Interactive Prompts
// ──────────────────────────────────────────────

async function promptAction(
  rl: readline.Interface,
): Promise<"login" | "register"> {
  const answer = await rl.question(
    "是否已有账号？(login/register, 默认 login): ",
  );
  const trimmed = answer.trim().toLowerCase();
  return trimmed === "register" ? "register" : "login";
}

async function promptEmail(rl: readline.Interface): Promise<string> {
  const email = await rl.question("请输入邮箱: ");
  const trimmed = email.trim();
  if (!trimmed.includes("@") || !trimmed.includes(".")) {
    console.log("⚠️  邮箱格式似乎不正确，请重试。");
    return promptEmail(rl);
  }
  return trimmed;
}

async function promptPassword(rl: readline.Interface): Promise<string> {
  const password = await rl.question("请输入密码: ");
  const trimmed = password.trim();
  if (trimmed.length < 6) {
    console.log("⚠️  密码长度至少 6 位，请重试。");
    return promptPassword(rl);
  }
  return trimmed;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Generate a unique machine identifier.
 * Combines hostname with a random UUID for uniqueness.
 */
function generateMachineId(): string {
  const hostname = os.hostname();
  const uuid = randomUUID().slice(0, 8);
  return `${hostname}-${uuid}`;
}