#!/usr/bin/env node
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { spawn, execSync } from "child_process";
import { createInterface } from "readline";
import path from "path";

const PID_FILE = ".dev-server.pid";
const PORT = 3000;

function question(query) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => { rl.close(); resolve(answer); });
  });
}

function isPortInUse(port) {
  try {
    execSync(`lsof -i :${port} 2>/dev/null`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function isPostgresRunning() {
  try {
    execSync("pg_isready -h localhost -p 5432 2>/dev/null", { stdio: "pipe" });
    return true;
  } catch {
    try {
      execSync("docker compose exec -T postgres pg_isready -U agenthub 2>/dev/null", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }
}

function getPostgresHint() {
  const platform = process.platform;
  if (platform === "darwin") return "brew services start postgresql@16";
  if (platform === "linux") return "sudo systemctl start postgresql";
  if (platform === "win32") return "Start PostgreSQL service from Services Manager (services.msc)";
  return "Start your PostgreSQL service";
}

function readPid() {
  try {
    return parseInt(readFileSync(PID_FILE, "utf-8").trim());
  } catch {
    return null;
  }
}

async function cmdStart() {
  console.log("🚀 Starting Agent Hub...\n");

  // Check if already running
  const existingPid = readPid();
  if (existingPid) {
    try {
      process.kill(existingPid, 0);
      console.log(`❌ Dev server is already running (PID ${existingPid})`);
      console.log("   Run 'npm run restart' to restart or 'npm run stop' to stop");
      process.exit(1);
    } catch {
      // PID stale, remove it
      try { unlinkSync(PID_FILE); } catch {}
    }
  }

  // Check port
  if (isPortInUse(PORT)) {
    console.log(`❌ Port ${PORT} is already in use`);
    const ans = await question("   Kill the existing process and continue? (y/N): ");
    if (ans.toLowerCase() !== "y") {
      console.log("   Aborted");
      process.exit(1);
    }
    try {
      execSync(`lsof -ti :${PORT} | xargs kill -9 2>/dev/null`, { stdio: "pipe" });
      console.log("   ✅ Killed existing process");
      await new Promise(r => setTimeout(r, 1000));
    } catch {}
  }

  // Check PostgreSQL
  if (!isPostgresRunning()) {
    console.log("❌ PostgreSQL is not running");
    console.log(`   ${getPostgresHint()}`);
    console.log("   Or start via Docker: docker compose up -d");
    const ans = await question("\n   Start Docker PostgreSQL and continue? (y/N): ");
    if (ans.toLowerCase() === "y") {
      try {
        execSync("docker compose up -d 2>/dev/null", { stdio: "inherit" });
        console.log("   ⏳ Waiting for PostgreSQL...");
        for (let i = 0; i < 12; i++) {
          try {
            execSync("docker compose exec -T postgres pg_isready -U agenthub 2>/dev/null", { stdio: "pipe" });
            console.log("   ✅ PostgreSQL is ready");
            break;
          } catch {
            await new Promise(r => setTimeout(r, 5000));
          }
        }
      } catch {
        console.log("   ❌ Failed to start Docker PostgreSQL");
        process.exit(1);
      }
    } else {
      console.log("   Aborted");
      console.log(`   Hint: ${getPostgresHint()}`);
      process.exit(1);
    }
  } else {
    console.log("✅ PostgreSQL is running");
  }

  // Prisma generate (ensure latest types)
  try {
    execSync("npx prisma generate 2>/dev/null", { stdio: "pipe" });
  } catch {}

  // Start Next.js dev server
  console.log("\n📦 Starting Next.js dev server...\n");
  const child = spawn("npx", ["next", "dev"], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env },
  });

  writeFileSync(PID_FILE, String(child.pid));

  // 先把 exit handler 注册好
  child.on("exit", (code) => {
    console.log(`\n⚠️ Dev server exited with code ${code}`);
    try { unlinkSync(PID_FILE); } catch {}
  });

  console.log(`\n📊 Agent Hub is running`);
  console.log(`   Dashboard: http://localhost:${PORT}`);
  console.log(`\n💡 To connect your agents, run in your project directory:`);
  console.log(`   agent-hub connect`);
}

function cmdStop() {
  console.log("🛑 Stopping Agent Hub...");
  const pid = readPid();
  if (!pid) {
    console.log("   No dev server is running");
    process.exit(0);
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`   ✅ Stopped dev server (PID ${pid})`);
  } catch {
    console.log("   ⚠️ Process not found, removing stale PID file");
  }
  try { unlinkSync(PID_FILE); } catch {}
}

async function cmdRestart() {
  console.log("🔄 Restarting Agent Hub...\n");
  cmdStop();
  await new Promise(r => setTimeout(r, 2000));
  // Clear .next cache
  try { execSync("rm -rf .next", { stdio: "pipe" }); } catch {}
  await cmdStart();
}

// Main
const cmd = process.argv[2];
switch (cmd) {
  case "start":
    await cmdStart();
    break;
  case "stop":
    cmdStop();
    break;
  case "restart":
    await cmdRestart();
    break;
  default:
    console.log("Usage: node scripts/dev.mjs <start|stop|restart>");
    process.exit(1);
}