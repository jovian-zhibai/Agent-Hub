// ──────────────────────────────────────────────
// Agent Hub SDK — Public API barrel
//
// Single entry point so consumers can:
//   import { KeyManager, DataReporter, opencodePlugin } from "@agent-hub/sdk";
//
// The OpenCode plugin is also available as default export for
// direct `import opencodePlugin from "@agent-hub/sdk"` usage.
// ──────────────────────────────────────────────

export { KeyManager } from "./key-manager";
export type {
  KeyBinding,
  KeyManagerConfig,
  ProviderConfig,
} from "./key-manager";

export { DataReporter } from "./data-reporter";
export type {
  TelemetryEvent,
  DataReporterConfig,
} from "./data-reporter";

export { PermissionChecker } from "./permission-checker";
export type {
  CheckParams,
  CheckDecision,
  PermissionRules,
  ToolRule,
  PermissionCacheEntry,
} from "./permission-checker";

export { LocalCache } from "./local-cache";
export type {
  CacheEntry,
  CacheStats,
} from "./local-cache";

export { default as opencodePlugin } from "./plugins/opencode-plugin";
export { default } from "./plugins/opencode-plugin";
