#!/usr/bin/env node
/**
 * deploy-plugins.mjs — 构建 SDK 并软链插件到各运行时目录
 *
 * 用法：npm run deploy
 *
 * 为什么用软链而不是拷贝：
 * - 手动拷贝会导致插件文件悄悄变旧（每次重构建都得重拷）
 * - 软链指向 dist/ 下的构建产物，重构建后自动生效
 * - 文件名固定（agent-hub-opencode.js / agent-hub-pi.js），运行时自动加载
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SDK_DIST = path.join(ROOT, "packages/sdk/dist/plugins");

const targets = [
  {
    name: "OpenCode plugin",
    source: path.join(SDK_DIST, "opencode-plugin.js"),
    dest: path.join(os.homedir(), ".config/opencode/plugins/agent-hub-opencode.js"),
  },
  {
    name: "Pi extension",
    source: path.join(SDK_DIST, "pi-extension.js"),
    dest: path.join(os.homedir(), ".pi/agent/extensions/agent-hub-pi.js"),
  },
];

console.log("🔨 Building SDK...");
execSync("npm run build", { cwd: path.join(ROOT, "packages/sdk"), stdio: "inherit" });

console.log("\n🔗 Deploying plugins (symlink)...");
for (const t of targets) {
  if (!fs.existsSync(t.source)) {
    console.error(`❌ ${t.name}: source not found: ${t.source}`);
    process.exit(1);
  }

  // 确保目标目录存在
  fs.mkdirSync(path.dirname(t.dest), { recursive: true });

  // 删除旧文件/软链，创建新软链
  if (fs.existsSync(t.dest) || fs.lstatSync(t.dest, { throwIfNoEntry: false })) {
    fs.rmSync(t.dest, { force: true });
  }
  fs.symlinkSync(t.source, t.dest);

  const realPath = fs.realpathSync(t.dest);
  console.log(`✅ ${t.name}: ${t.dest} -> ${realPath}`);
}

console.log("\n🎉 Deploy complete! Restart OpenCode/Pi to load new plugins.");
console.log("   Debug: AGENT_HUB_DEBUG=1 <command> to enable verbose logging.");
