import { defineConfig } from "tsup";

// SDK build config — ESM + DTS, ready for npm publish.
// Usage: cd packages/sdk && npm run build
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // Keep @opencode-ai/plugin as external (peer dep)
  external: ["@opencode-ai/plugin"],
});
