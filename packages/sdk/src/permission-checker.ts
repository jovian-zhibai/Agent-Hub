// ──────────────────────────────────────────────
// Agent Hub SDK — PermissionChecker
// 权限拦截：按工具名匹配规则，返回 allow / deny / ask
// ──────────────────────────────────────────────

import { LocalCache } from "./local-cache";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface CheckParams {
  /** Tool type identifier: "edit" | "bash" | "read" | "webfetch" | "write" */
  toolType: string;
  /** Tool name within its category, e.g. "bash:read" */
  toolName: string;
  /** Optional tool input for context-aware checks (path matching, etc.) */
  toolInput?: Record<string, unknown>;
  /** When true, deny all bash operations */
  safetyMode?: boolean;
}

export type CheckDecision = "allow" | "deny" | "ask";

/**
 * Schema of the rules JSON stored in the Permission model.
 * Designed to match the Prisma `Permission.rules` JSONB field.
 */
export interface PermissionRules {
  /** Overall version of the rules document */
  version?: number;
  /** Per-tool-type rules */
  tools?: {
    /** e.g. "bash": { allow: true, ask: true, deny_paths: ["/etc"] } */
    [toolType: string]: ToolRule;
  };
}

export interface ToolRule {
  /** Explicitly allow this tool type */
  allow?: boolean;
  /** Prompt the user for approval */
  ask?: boolean;
  /** Explicitly deny */
  deny?: boolean;
  /** For read tools: path patterns to deny */
  denyPaths?: string[];
  /** For write tools: path patterns to deny */
  writeDenyPaths?: string[];
  /** Safety mode overrides */
  safetyMode?: {
    deny?: boolean;
  };
}

export interface PermissionCacheEntry {
  version: number;
  safetyMode: boolean;
  rules: PermissionRules;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const CACHE_KEY = "permissions";
const CHECK_TIMEOUT_MS = 500;

// ──────────────────────────────────────────────
// PermissionChecker
// ──────────────────────────────────────────────

export class PermissionChecker {
  private rules: PermissionRules | null = null;
  private safetyMode: boolean = false;
  private rulesVersion: number = 0;
  private loaded: boolean = false;
  private disabled: boolean = false;

  constructor(private cache: LocalCache) {}

  // ── Public API ───────────────────────────────

  /**
   * Check whether a tool call is allowed.
   *
   * P0 Bug 3 fix: 500ms timeout, returns "deny" if the check exceeds the deadline.
   */
  async check(params: CheckParams): Promise<CheckDecision> {
    // Timeout race — if check takes >500ms, return deny
    const result = await Promise.race([
      this.performCheck(params),
      this.timeout(CHECK_TIMEOUT_MS),
    ]);

    return result;
  }

  /**
   * Reload permission rules from the local cache.
   */
  async reload(): Promise<void> {
    try {
      const entry = await this.cache.get<PermissionCacheEntry>(CACHE_KEY);
      if (entry === null) {
        this.rules = null;
        this.safetyMode = false;
        this.rulesVersion = 0;
        this.loaded = false;
        this.disabled = false;
        return;
      }

      this.rules = entry.rules;
      this.safetyMode = entry.safetyMode;
      this.rulesVersion = entry.version;
      this.loaded = true;
      this.disabled = false;
    } catch {
      // If cache is unavailable, stay in last known state or deny-all
      this.loaded = false;
    }
  }

  /**
   * Whether the agent is disabled (rules explicitly deny all).
   */
  get isDisabled(): boolean {
    return this.disabled;
  }

  // ── Internal Check Logic ─────────────────────

  private async performCheck(params: CheckParams): Promise<CheckDecision> {
    // Ensure rules are loaded
    if (!this.loaded) {
      await this.reload();
    }

    // No rules loaded — default to allow (no restrictions known)
    if (!this.rules) {
      return "allow";
    }

    // Safety mode: deny bash
    if (params.safetyMode && params.toolType === "bash") {
      return "deny";
    }

    const toolRule = this.rules.tools?.[params.toolType];

    // No specific rule for this tool type — check global safety only
    if (!toolRule) {
      return "allow";
    }

    // Check safety mode override
    if (params.safetyMode && toolRule.safetyMode?.deny) {
      return "deny";
    }

    // Explicit deny overrides everything
    if (toolRule.deny) {
      return "deny";
    }

    // File path interception for read/write tools
    if (params.toolInput && (params.toolType === "read" || params.toolType === "write")) {
      const denyPaths = params.toolType === "read"
        ? toolRule.denyPaths
        : toolRule.writeDenyPaths ?? toolRule.denyPaths;

      if (denyPaths && denyPaths.length > 0) {
        const targetPath = this.extractPath(params.toolInput);
        if (targetPath !== null && this.matchesDenyPath(targetPath, denyPaths)) {
          return "deny";
        }
      }
    }

    // Ask takes priority over allow
    if (toolRule.ask) {
      return "ask";
    }

    // Default: allow
    return "allow";
  }

  /**
   * Extract a file path from tool input for path-based interception.
   */
  private extractPath(input: Record<string, unknown>): string | null {
    // Common fields that carry a file path
    const pathCandidates = ["filePath", "path", "file", "target", "filename"];
    for (const key of pathCandidates) {
      const value = input[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
    return null;
  }

  /**
   * Check if a path matches any of the deny patterns.
   * Supports exact prefix matches and glob-style "*" suffixes.
   */
  private matchesDenyPath(targetPath: string, denyPaths: string[]): boolean {
    for (const pattern of denyPaths) {
      if (pattern.endsWith("*")) {
        // Prefix match (e.g., "/etc/*" matches "/etc/passwd")
        const prefix = pattern.slice(0, -1);
        if (targetPath.startsWith(prefix)) {
          return true;
        }
      } else if (pattern.endsWith("/")) {
        // Directory prefix match
        if (targetPath.startsWith(pattern) || targetPath === pattern.slice(0, -1)) {
          return true;
        }
      } else {
        // Exact match
        if (targetPath === pattern) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Produce a "deny" result after a timeout.
   */
  private async timeout(ms: number): Promise<"deny"> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return "deny";
  }
}