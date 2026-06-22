import type { NextConfig } from "next";

// ── Inline env validation for next.config.ts ───
// Using inline check instead of importing from @/lib/env to avoid
// module resolution issues at config load time.
const REQUIRED_ENV_VARS = ["DATABASE_URL", "JWT_SECRET", "KEY_ENCRYPTION_KEY"];
const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  const msg = `Missing required environment variables: ${missing.join(", ")}`;
  console.error("[ENV] " + msg);
  if (process.env.NODE_ENV === "production") {
    throw new Error(msg);
  }
}

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
