// ──────────────────────────────────────────────
// Agent Hub CLI — Config Management
// 管理 ~/.agent-hub/config.json
// ──────────────────────────────────────────────

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface AgentHubConfig {
  /** Backend API base URL */
  apiBaseUrl: string;
  /** JWT auth token from login/register */
  authToken?: string;
  /** Agent-specific token for telemetry (long-lived, scoped) */
  agentToken?: string;
  /** Registered agent UUID */
  agentId?: string;
  /** Human-readable agent name */
  agentName?: string;
  /** Machine fingerprint ID */
  machineId?: string;
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), ".agent-hub");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Read the local config file.
 * Returns a default config if the file doesn't exist or is corrupt.
 */
export async function readConfig(): Promise<AgentHubConfig> {
  try {
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<AgentHubConfig>;

    // Validate required fields
    return {
      apiBaseUrl: parsed.apiBaseUrl ?? getDefaultApiUrl(),
      authToken: parsed.authToken,
      agentToken: parsed.agentToken,
      agentId: parsed.agentId,
      agentName: parsed.agentName,
      machineId: parsed.machineId,
    };
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === "ENOENT") {
      return { apiBaseUrl: getDefaultApiUrl() };
    }
    // Corrupt file — return default
    return { apiBaseUrl: getDefaultApiUrl() };
  }
}

/**
 * Write config to the local file.
 * Creates ~/.agent-hub/ directory if needed.
 */
export async function writeConfig(config: AgentHubConfig): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Read a specific JSON cache file from ~/.agent-hub/.
 * Returns null if the file doesn't exist or is corrupt.
 */
export async function readCacheFile<T>(filename: string): Promise<T | null> {
  const filePath = path.join(CONFIG_DIR, filename);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Write a JSON cache file to ~/.agent-hub/.
 */
export async function writeCacheFile<T>(
  filename: string,
  data: T,
): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const filePath = path.join(CONFIG_DIR, filename);
  const tmpPath = filePath + ".tmp";
  try {
    await fs.writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await fs.rename(tmpPath, filePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

/**
 * Check if the user is already connected (has authToken).
 */
export async function isConnected(): Promise<boolean> {
  const config = await readConfig();
  return config.authToken !== undefined && config.authToken.length > 0;
}

/**
 * Get the default API URL from environment or hardcoded default.
 */
function getDefaultApiUrl(): string {
  return process.env.AGENT_HUB_API_URL ?? "http://localhost:3000";
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

interface NodeError extends Error {
  code?: string;
}

function isNodeError(err: unknown): err is NodeError {
  return err instanceof Error && "code" in err;
}