#!/usr/bin/env node

// ──────────────────────────────────────────────
// Agent Hub CLI — 入口文件
// ──────────────────────────────────────────────

import { Command } from "commander";
import { createConnectCommand } from "./commands/connect.js";
import { createSyncCommand } from "./commands/sync.js";
import { createHookCommand } from "./commands/hook.js";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("agent-hub")
    .description("Agent Hub CLI — 连接和管理你的 AI Agent")
    .version("1.0.0");

  // Register commands
  createConnectCommand(program);
  createSyncCommand(program);
  createHookCommand(program);

  // Parse and execute
  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`❌ 未捕获的错误: ${message}`);
  process.exit(1);
});