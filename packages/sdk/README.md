# @agent-hub/sdk

TypeScript SDK for integrating local AI coding agents with the Agent Hub platform: permission checking, telemetry reporting, API key management, local configuration caching, and the OpenCode plugin adapter.

## Layout

```
src/
  key-manager.ts          # KeyManager — multi-key binding status and failover
  data-reporter.ts        # DataReporter — batched telemetry reporting with retry/offline queue
  permission-checker.ts   # PermissionChecker — tool-level allow / deny / ask decisions
  local-cache.ts          # LocalCache — file cache for dashboard-delivered configuration
  plugins/
    opencode-plugin.ts    # opencodePlugin — OpenCode hook adapter
  index.ts                # Public API barrel
```

## Exports

| Export | Description | Related types |
|--------|-------------|---------------|
| `KeyManager` | Tracks API key bindings and their status; moves a 429-throttled key to `standby` and returns it to `active` after the rate-limit window passes | `KeyBinding`, `KeyManagerConfig`, `ProviderConfig` |
| `DataReporter` | Sends telemetry events to the platform in batches; retries failed reports and queues events offline when the API is unreachable | `TelemetryEvent`, `DataReporterConfig` |
| `PermissionChecker` | Checks a tool call against permission rules and returns `allow`, `deny`, or `ask`; denies on a check timeout | `CheckParams`, `CheckDecision`, `PermissionRules`, `ToolRule`, `PermissionCacheEntry` |
| `LocalCache` | Persists dashboard-delivered configuration to the local file cache under `~/.agent-hub/` | `CacheEntry`, `CacheStats` |
| `opencodePlugin` (default export) | OpenCode plugin that registers the `permission.ask`, `tool.execute.before`, and `llm.completion` hooks | Plugin config: `apiBaseUrl`, `authToken`, `agentId` |

### Event and rule shapes

- `TelemetryEvent.type` covers tool calls, token usage, permission denials, key health, heartbeat, key failover, and agent enable/disable events.
- `CheckParams` carries `toolType`, `toolName`, `toolInput`, and optional `safetyMode`.
- `ToolRule` supports `allow`, `ask`, `deny`, read-path `denyPaths`, write-path `writeDenyPaths`, and a per-tool `safetyMode.deny` flag.
- `KeyBinding.status` is one of `active`, `standby`, `depleted`, `failed`.

## Build

From the SDK directory:

```bash
cd packages/sdk
npm install
npm run build   # tsup → dist/index.js, dist/index.d.ts, dist/plugins/opencode-plugin.*
```

Type check without emitting:

```bash
npm run type-check
```

## Package entry points

- `.` → `dist/index.js` with the barrel exports above.
- `./opencode-plugin` → the compiled OpenCode plugin adapter.

The SDK depends on `@opencode-ai/plugin` for the plugin adapter; the remaining classes are plain TypeScript with no platform framework dependency.

## Notes for consumers

- `DataReporterConfig.apiBaseUrl` must be an absolute URL; the reporter appends the batch telemetry endpoint itself.
- If permission rules are unavailable, the checker defaults to `allow`; an explicit deny rule, a denied path pattern, or a safety-mode bash denial overrides that default.
- Local cache entries carry a version, creation timestamp, and optional expiry (`expiresAt: null` means never expires).
