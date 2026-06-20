#!/usr/bin/env node
import { randomBytes } from "crypto";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { createInterface } from "readline";

function run(cmd, opts = {}) {
  console.log(`  $ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

function question(query) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => { rl.close(); resolve(answer); });
  });
}

async function main() {
  console.log("\n🔧 Agent Hub Setup\n");

  // Step 1: Create .env from .env.example if not exists
  if (!existsSync(".env")) {
    console.log("📝 Creating .env with generated secrets...");
    if (!existsSync(".env.example")) {
      console.error("   ❌ .env.example not found. Run 'npm run setup' from the project root.");
      process.exit(1);
    }
    let example = readFileSync(".env.example", "utf-8");
    const jwtSecret = randomBytes(32).toString("hex");
    const encKey = randomBytes(32).toString("hex");
    example = example
      .replace("please-run-setup-script", jwtSecret)
      .replace("please-run-setup-script", encKey);
    writeFileSync(".env", example);
    console.log("   ✅ .env created with JWT_SECRET and KEY_ENCRYPTION_KEY");
  } else {
    console.log("✅ .env already exists");
    // 兜底检测：检查关键字段是否缺失
    const envContent = readFileSync(".env", "utf-8");
    let needsUpdate = false;

    if (!envContent.includes("JWT_SECRET=") || envContent.includes("JWT_SECRET=\"\"") || envContent.match(/JWT_SECRET=$/m)) {
      const jwtSecret = randomBytes(32).toString("hex");
      writeFileSync(".env", `JWT_SECRET=${jwtSecret}\n`, { flag: "a" });
      console.log("   ⚠️ JWT_SECRET was missing, generated new one");
      needsUpdate = true;
    }

    if (!envContent.includes("KEY_ENCRYPTION_KEY=") || envContent.includes("KEY_ENCRYPTION_KEY=\"\"") || envContent.match(/KEY_ENCRYPTION_KEY=$/m)) {
      const encKey = randomBytes(32).toString("hex");
      writeFileSync(".env", `KEY_ENCRYPTION_KEY=${encKey}\n`, { flag: "a" });
      console.log("   ⚠️ KEY_ENCRYPTION_KEY was missing, generated new one");
      needsUpdate = true;
    }

    if (!envContent.includes("NEXT_PUBLIC_API_URL=")) {
      writeFileSync(".env", `NEXT_PUBLIC_API_URL=http://localhost:3000\n`, { flag: "a" });
      console.log("   ⚠️ NEXT_PUBLIC_API_URL was missing, added default");
      needsUpdate = true;
    }

    if (!needsUpdate) {
      console.log("   ✅ All required fields present");
    }
  }

  // Step 2: Check PostgreSQL — three-tier logic
  console.log("\n🐘 Checking PostgreSQL...");
  let pgReady = false;

  // Tier 1: Try connecting to local 5432
  try {
    execSync("pg_isready -h localhost -p 5432 2>/dev/null || nc -z localhost 5432 2>/dev/null", {
      stdio: "pipe", timeout: 5000
    });
    pgReady = true;
    console.log("   ✅ PostgreSQL is running on localhost:5432");
  } catch {
    // Tier 2: Check Docker, try docker compose
    try {
      execSync("docker --version 2>/dev/null", { stdio: "pipe" });
      console.log("   🐳 Starting PostgreSQL via Docker...");
      execSync("docker compose up -d", { stdio: "inherit" });

      // Wait for PG to be ready
      console.log("   ⏳ Waiting for PostgreSQL to be ready...");
      for (let i = 0; i < 12; i++) {
        try {
          execSync("docker compose exec -T postgres pg_isready -U agenthub 2>/dev/null", { stdio: "pipe" });
          pgReady = true;
          break;
        } catch {
          await new Promise(r => setTimeout(r, 5000));
        }
      }
      if (pgReady) {
        console.log("   ✅ PostgreSQL is ready");
      } else {
        console.log("   ❌ PostgreSQL did not become ready in time");
      }
    } catch {
      // Tier 3: No Docker, print install instructions
      console.log("   ❌ PostgreSQL not found and Docker not available");
      console.log("\n   Please install PostgreSQL manually:");
      console.log("   Mac:     brew install postgresql@16 && brew services start postgresql@16");
      console.log("   Linux:   sudo apt install postgresql && sudo systemctl start postgresql");
      console.log("   Windows: https://www.postgresql.org/download/windows/");
      console.log("\n   Then re-run: npm run setup");
    }
  }

  if (!pgReady) {
    console.log("\n❌ Setup incomplete: PostgreSQL is required");
    process.exit(1);
  }

  // Step 3: Install dependencies
  console.log("\n📦 Installing dependencies...");
  run("npm install");

  // Step 4: Run database migrations
  console.log("\n🗄️ Running database migrations...");
  run("npx prisma migrate deploy");
  run("npx prisma generate");

  // Step 5: Link CLI
  console.log("\n🔗 Linking CLI...");
  try {
    run("npm link");
    console.log("   ✅ agent-hub CLI available");
  } catch {
    console.log("   ⚠️ npm link failed, CLI won't be available globally");
    console.log("   Run 'npm link' manually after setup");
  }

  console.log("\n✅ Setup complete!");
  console.log("   Run 'npm run dev' to start the development server");
  console.log("   Open http://localhost:3000 in your browser");
}

main().catch((err) => {
  console.error("\n❌ Setup failed:", err.message);
  process.exit(1);
});
