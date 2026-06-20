// ──────────────────────────────────────────────
// Agent Hub CLI — hook 命令
// 安装 Claude Code PreToolUse Hook
// ──────────────────────────────────────────────

import { Command } from "commander";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const AGENT_HUB_DIR = path.join(os.homedir(), ".agent-hub");
const HOOKS_DIR = path.join(AGENT_HUB_DIR, "hooks");
const HOOK_DEST = path.join(HOOKS_DIR, "permission-check.sh");
const CLAUDE_SETTINGS_DIR = path.join(os.homedir(), ".claude");
const CLAUDE_SETTINGS_PATH = path.join(CLAUDE_SETTINGS_DIR, "settings.json");

// ──────────────────────────────────────────────
// Command definition
// ──────────────────────────────────────────────

export function createHookCommand(program: Command): void {
  program
    .command("hook")
    .description("管理 Agent Hub hook")
    .addCommand(
      new Command("install")
        .description("安装 Claude Code PreToolUse Hook")
        .action(handleHookInstall),
    )
    .addCommand(
      new Command("uninstall")
        .description("卸载 Claude Code PreToolUse Hook")
        .action(handleHookUninstall),
    )
    .addCommand(
      new Command("status")
        .description("检查 hook 安装状态")
        .action(handleHookStatus),
    );
}

// ──────────────────────────────────────────────
// Handler: install
// ──────────────────────────────────────────────

async function handleHookInstall(): Promise<void> {
  try {
    // ── Step 1: 确定 hook 脚本源路径 ────────────
    // 在开发环境中，脚本就在 src/hooks/ 目录下
    // 在已安装的包中，脚本在 package 的 dist/hooks/ 中
    const scriptSourcePath = await resolveHookSourcePath();

    // ── Step 2: 创建 ~/.agent-hub/hooks/ 目录 ────
    await fs.mkdir(HOOKS_DIR, { recursive: true });

    // ── Step 3: 复制 hook 脚本 ──────────────────
    await fs.copyFile(scriptSourcePath, HOOK_DEST);
    await fs.chmod(HOOK_DEST, 0o755); // 可执行
    console.log(`   📄 Hook 脚本已复制到 ${HOOK_DEST}`);

    // ── Step 4: 读取/创建 Claude settings.json ──
    await fs.mkdir(CLAUDE_SETTINGS_DIR, { recursive: true });

    let settings: Record<string, unknown> = {};
    try {
      const raw = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // 文件不存在或无法解析 → 从空配置开始
    }

    // ── Step 5: 向 hooks.PreToolUse 数组添加 hook ─
    const hooks = (settings.hooks as Record<string, unknown>) ?? {};
    const preToolUse = (hooks.PreToolUse as Array<unknown>) ?? [];

    // 检查是否已安装（避免重复）
    const alreadyInstalled = preToolUse.some(
      (entry) =>
        typeof entry === "string" && entry.includes("permission-check.sh"),
    );

    if (alreadyInstalled) {
      console.log("   ℹ️  Hook 已安装，跳过重复注册");
    } else {
      preToolUse.push(HOOK_DEST);
      hooks.PreToolUse = preToolUse;
      settings.hooks = hooks;

      // ── Step 6: 写回 settings.json ────────────
      await fs.writeFile(
        CLAUDE_SETTINGS_PATH,
        JSON.stringify(settings, null, 2),
        "utf-8",
      );
      console.log(`   📝 Claude settings.json 已更新: ${CLAUDE_SETTINGS_PATH}`);
    }

    console.log("");
    console.log("✅ Claude Code PreToolUse hook 已安装");
    console.log("   下次启动 Claude Code 时生效");
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Hook 安装失败: ${message}`);
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// Handler: uninstall
// ──────────────────────────────────────────────

async function handleHookUninstall(): Promise<void> {
  try {
    // ── Step 1: 从 Claude settings.json 移除 hook 条目 ──
    await fs.mkdir(CLAUDE_SETTINGS_DIR, { recursive: true });

    let settings: Record<string, unknown> = {};
    let settingsModified = false;

    try {
      const raw = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // 文件不存在→无需移除
    }

    const hooks = (settings.hooks as Record<string, unknown>) ?? {};
    const preToolUse = (hooks.PreToolUse as Array<unknown>) ?? [];

    const filtered = preToolUse.filter(
      (entry) =>
        !(typeof entry === "string" && entry.includes("permission-check.sh")),
    );

    if (filtered.length !== preToolUse.length) {
      settingsModified = true;
      hooks.PreToolUse = filtered;
      settings.hooks = hooks;
      await fs.writeFile(
        CLAUDE_SETTINGS_PATH,
        JSON.stringify(settings, null, 2),
        "utf-8",
      );
      console.log("   📝 Claude settings.json 已更新（移除了 hook 条目）");
    }

    // ── Step 2: 删除 hook 脚本文件（如果存在） ──
    try {
      await fs.unlink(HOOK_DEST);
      console.log(`   🗑️  Hook 脚本已删除: ${HOOK_DEST}`);
    } catch {
      // 文件不存在→无需删除
    }

    if (!settingsModified) {
      console.log("   ℹ️  Hook 未安装，无需卸载");
    }

    console.log("");
    console.log("✅ Claude Code PreToolUse hook 已卸载");
    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Hook 卸载失败: ${message}`);
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// Handler: status
// ──────────────────────────────────────────────

async function handleHookStatus(): Promise<void> {
  try {
    // ── Step 1: 检查 hook 脚本文件是否存在 ──────
    let scriptExists = false;
    try {
      await fs.access(HOOK_DEST, fs.constants.F_OK);
      scriptExists = true;
    } catch {
      // 不存在
    }

    console.log("🔍 Claude Code Hook 安装状态：");
    console.log("");

    // ── Step 2: 检查 Claude settings.json ────────
    let registeredInSettings = false;
    try {
      const raw = await fs.readFile(CLAUDE_SETTINGS_PATH, "utf-8");
      const settings = JSON.parse(raw) as Record<string, unknown>;
      const hooks = (settings.hooks as Record<string, unknown>) ?? {};
      const preToolUse = (hooks.PreToolUse as Array<unknown>) ?? [];
      registeredInSettings = preToolUse.some(
        (entry) =>
          typeof entry === "string" && entry.includes("permission-check.sh"),
      );
    } catch {
      // 文件不存在→未注册
    }

    if (scriptExists && registeredInSettings) {
      console.log("   ✅ Hook 脚本: 已安装 →", HOOK_DEST);
      console.log("   ✅ Claude 注册: 已注册");
    } else if (scriptExists && !registeredInSettings) {
      console.log("   ⚠️  Hook 脚本: 已存在（但未在 Claude settings 中注册）");
      console.log(`      可运行 \`agent-hub hook install\` 修复`);
    } else {
      console.log("   ❌ Hook 脚本: 未安装");
      console.log(`      可运行 \`agent-hub hook install\` 安装`);
    }

    process.exit(0);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ 状态检查失败: ${message}`);
    process.exit(1);
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * 解析 hook 脚本的源路径。
 * 开发环境下在 src/hooks/，已安装的包在 package 目录的 dist/hooks/ 或 hooks/。
 */
async function resolveHookSourcePath(): Promise<string> {
  // 尝试当前文件的相对路径（开发模式）
  const devPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "hooks",
    "permission-check.sh",
  );
  try {
    await fs.access(devPath, fs.constants.F_OK);
    return devPath;
  } catch {
    // 开发路径不存在
  }

  // 尝试从 node_modules 中
  const candidates = [
    // 从 script 所在目录回退到 hooks/
    path.join(__dirname, "..", "hooks", "permission-check.sh"),
    // npm 包全局安装后的路径
    path.join(__dirname, "..", "..", "hooks", "permission-check.sh"),
    // 用 __dirname 回退
    path.join(__dirname, "hooks", "permission-check.sh"),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate, fs.constants.F_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  // 兜底：直接复制内联内容（避免文件缺失导致安装失败）
  throw new Error(
    `无法找到 permission-check.sh 脚本。请确保在 agent-hub 项目根目录运行此命令。`,
  );
}