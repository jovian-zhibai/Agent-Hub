import { defineConfig } from "tsup";

// CLI build config — single ESM bundle with shebang banner.
// Usage: cd packages/cli && npm run build
// Output: dist/index.js (executable via `agent-hub` bin)
export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // Preserve the shebang so the output is directly executable
  banner: { js: "#!/usr/bin/env node" },
  // Bundle all deps except node built-ins
  noExternal: ["commander", "js-yaml"],
});
