import { defineConfig } from "tsup";

// SDK build config — ESM, ready for npm publish.
// Usage: cd packages/sdk && npm run build
//
// Note: dts temporarily disabled — @opencode-ai/plugin type exports mismatch
// (Permission/ToolExecuteInput not exported) + permission_degraded type missing.
// JS runtime works fine; DTS will be restored after type fixes.
export default defineConfig({
  // Main SDK entry + runtime plugin entries (opencode plugin + pi extension)
  entry: [
    "src/index.ts",
    "src/plugins/opencode-plugin.ts",
    "src/plugins/pi-extension.ts",
  ],
  format: ["esm"],
  dts: false, // TODO: restore after type fixes
  sourcemap: true,
  clean: true,
  target: "es2022",
  // Disable code splitting so each plugin entry is a standalone single file
  // (can be dropped into ~/.config/opencode/plugins/ without relative chunk imports)
  splitting: false,
  // Keep @opencode-ai/plugin as external (peer dep)
  external: ["@opencode-ai/plugin"],
});
