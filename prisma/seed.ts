import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const providers = [
    {
      name: "openai",
      displayName: "OpenAI",
      supportedProtocols: ["openai"],
      baseUrls: { openai: "https://api.openai.com/v1" },
    },
    {
      name: "anthropic",
      displayName: "Anthropic",
      supportedProtocols: ["anthropic"],
      baseUrls: { anthropic: "https://api.anthropic.com/v1" },
    },
    {
      name: "deepseek",
      displayName: "DeepSeek",
      supportedProtocols: ["openai", "anthropic"],
      baseUrls: {
        openai: "https://api.deepseek.com/v1",
        anthropic: "https://api.deepseek.com/v1",
      },
    },
    {
      name: "google",
      displayName: "Google",
      supportedProtocols: ["openai"],
      baseUrls: {
        openai: "https://generativelanguage.googleapis.com/v1beta/openai",
      },
    },
  ];

  for (const p of providers) {
    await prisma.provider.upsert({
      where: { name: p.name },
      update: {},
      create: p,
    });
  }
  console.log("✅ Providers seeded:", providers.length);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());