// ──────────────────────────────────────────────
// Agent Hub CLI — Agent Scanner
// 扫描本地环境，发现 Agent 配置
// ──────────────────────────────────────────────

import * as fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as process from "node:process";
import { execSync } from "node:child_process";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface DiscoveredAgent {
  /** Display name for the agent */
  name: string;
  /** File path where the agent was defined */
  sourcePath: string;
  /** Agent type (e.g. "opencode", "claude", "manual") */
  type: "opencode" | "claude" | "manual";
  /** Project name (derived from git root or directory name) */
  projectName: string;
  /** Project root path */
  projectPath: string;
  /** Agent-specific metadata */
  metadata: Record<string, string>;
}

export interface ScannerResult {
  /** All discovered agents */
  agents: DiscoveredAgent[];
  /** Project root path where OPC config was found */
  projectRoot?: string;
  /** Errors encountered during scan (non-fatal) */
  warnings: string[];
}

export interface ScannedKey {
  providerId: string;
  keyLabel: string;
  keyEncrypted: string;  // 原始 Key，CLI 读出来传给后端加密
  baseUrl: string;
  protocol: string;
}

// ──────────────────────────────────────────────
// API Key Scanner
// ──────────────────────────────────────────────

/**
 * Scan opencode.json for LLM provider API keys.
 */
export function scanKeys(projectDir: string): ScannedKey[] {
  const configPath = path.join(projectDir, "opencode.json");
  if (!existsSync(configPath)) return [];

  const config = JSON.parse(readFileSync(configPath, "utf-8"));
  const providers = config.provider;
  if (!providers) return [];

  const keys: ScannedKey[] = [];
  for (const [providerId, providerConfig] of Object.entries(providers)) {
    const opts = (providerConfig as any).options || {};
    const apiKey = opts.apiKey;
    if (!apiKey) continue;

    keys.push({
      providerId,
      keyLabel: (providerConfig as any).name || providerId,
      keyEncrypted: apiKey,
      baseUrl: opts.baseURL || "",
      protocol: "openai",
    });
  }
  return keys;
}

// ──────────────────────────────────────────────
// Scan paths (in priority order)
// ──────────────────────────────────────────────

interface ScanTarget {
  type: DiscoveredAgent["type"];
  label: string;
  checkPath: string; // relative to the project root
  parser: (fullPath: string, projectRoot: string) => Promise<DiscoveredAgent[]>;
}

const SCAN_TARGETS: ScanTarget[] = [
  {
    type: "opencode",
    label: "OPC Agent",
    checkPath: ".opencode/agents",
    parser: scanOpenCodeAgentsDir,
  },
  {
    type: "claude",
    label: "Claude Config",
    checkPath: "opencode.json",
    parser: scanOpenCodeJson,
  },
  {
    type: "claude",
    label: "Claude Config",
    checkPath: ".claude/opencode.json",
    parser: scanOpenCodeJson,
  },
  {
    type: "manual",
    label: "Manual Config",
    checkPath: ".agent-hub.yml",
    parser: scanManualConfig,
  },
];

// ──────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────

/**
 * Scan the environment for AI agent configurations.
 * Tries the current working directory and common locations.
 */
export async function scanEnvironment(): Promise<ScannerResult> {
  const warnings: string[] = [];
  const allAgents: DiscoveredAgent[] = [];

  // Try to find the project root (look for opencode.json or .opencode/)
  const projectRoot = await findProjectRoot(process.cwd());

  if (!projectRoot) {
    warnings.push("未找到项目根目录（未检测到 opencode.json 或 .opencode/ 目录）");
    return { agents: [], warnings };
  }

  // Detect project info
  const projectName = detectProjectName(projectRoot);
  const projectPath = projectRoot;

  // Scan each target
  for (const target of SCAN_TARGETS) {
    const fullPath = path.join(projectRoot, target.checkPath);
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile() && target.checkPath.endsWith(".json")) continue;
      if (!stat.isDirectory() && !target.checkPath.endsWith(".json") && !target.checkPath.endsWith(".yml")) continue;

      const agents = await target.parser(fullPath, projectRoot);
      // Add project info to each discovered agent
      for (const agent of agents) {
        agent.projectName = projectName;
        agent.projectPath = projectPath;
      }
      allAgents.push(...agents);
    } catch {
      // Path doesn't exist — skip silently
      continue;
    }
  }

  return {
    agents: allAgents,
    projectRoot,
    warnings,
  };
}

// ──────────────────────────────────────────────
// Parsers
// ──────────────────────────────────────────────

/**
 * Parse .opencode/agents/*.md — each .md file is one agent.
 */
async function scanOpenCodeAgentsDir(
  dirPath: string,
  projectRoot: string,
): Promise<DiscoveredAgent[]> {
  const agents: DiscoveredAgent[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;

    const fullPath = path.join(dirPath, entry.name);
    const content = await fs.readFile(fullPath, "utf-8");
    const lines = content.split("\n");

    // Try to extract agent name from YAML frontmatter first
    const fm = parseFrontmatter(content);
    const fmName = fm.name?.trim();
    // 从文件名提取（首字母大写），比如 "advisor.md" → "Advisor"
    const fileName = entry.name.replace(/\.md$/, "");
    const fromFileName = fileName
      .split(/[-_]/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("-");
    const fmDesc = fm.description?.trim();
    const agentName = fmName
      || fromFileName
      || fmDesc
      || "Unknown Agent";

    // Extract model info if present
    const modelLine = lines.find(
      (l) => l.startsWith("**Model**:") || l.startsWith("- Model:"),
    );
    const metadata: Record<string, string> = {};
    if (modelLine) {
      metadata.model = modelLine.replace(/^\*\*Model\*\*\s*:\s*/, "").trim();
    }

    agents.push({
      name: agentName,
      sourcePath: path.relative(projectRoot, fullPath),
      type: "opencode",
      projectName: "",
      projectPath: projectRoot,
      metadata,
    });
  }

  return agents;
}

/**
 * Parse opencode.json — extract agent definitions from the JSON.
 */
async function scanOpenCodeJson(
  filePath: string,
  projectRoot: string,
): Promise<DiscoveredAgent[]> {
  const agents: DiscoveredAgent[] = [];
  const raw = await fs.readFile(filePath, "utf-8");
  const config = JSON.parse(raw) as Record<string, unknown>;

  // Check for agents defined in opencode.json
  const agentsDef = config.agents as
    | Array<Record<string, unknown>>
    | undefined;
  if (Array.isArray(agentsDef)) {
    for (const agent of agentsDef) {
      const name = (agent.name as string) ?? (agent.id as string) ?? "Unknown";
      agents.push({
        name,
        sourcePath: path.relative(projectRoot, filePath),
        type: "claude",
        projectName: "",
        projectPath: projectRoot,
        metadata: {
          id: (agent.id as string) ?? "",
          model: (agent.model as string) ?? "",
        },
      });
    }
  }

  // If no agents array, treat the whole file as one agent definition
  if (agents.length === 0) {
    const name = (config.name as string) ?? "Default Agent";
    agents.push({
      name,
      sourcePath: path.relative(projectRoot, filePath),
      type: "claude",
      projectName: "",
      projectPath: projectRoot,
      metadata: {
        model: (config.model as string) ?? "",
      },
    });
  }

  return agents;
}

/**
 * Parse .agent-hub.yml — manual agent configuration file.
 */
async function scanManualConfig(
  filePath: string,
  projectRoot: string,
): Promise<DiscoveredAgent[]> {
  // Try parsing as JSON first (in case it's misnamed)
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const config = JSON.parse(raw) as Record<string, unknown>;
    const agentsList = (config.agents as Array<Record<string, unknown>>) ?? [
      config,
    ];
    return agentsList.map((agent) => ({
      name: (agent.name as string) ?? "Manual Agent",
      sourcePath: path.relative(projectRoot, filePath),
      type: "manual" as const,
      projectName: "",
      projectPath: projectRoot,
      metadata: {
        description: (agent.description as string) ?? "",
      },
    }));
  } catch {
    // Not JSON — treat as a single agent entry
    return [
      {
        name: "Manual Agent",
        sourcePath: path.relative(projectRoot, filePath),
        type: "manual",
        projectName: "",
        projectPath: projectRoot,
        metadata: {},
      },
    ];
  }
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Find the project root by looking for sentinel files.
 * Starts from `startPath` and walks up.
 */
async function findProjectRoot(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);

  for (let i = 0; i < 10; i++) {
    try {
      const entries = await fs.readdir(current);
      const hasOpenCode = entries.includes(".opencode");
      const hasOpenCodeJson = entries.includes("opencode.json");
      const hasGit = entries.includes(".git");

      if (hasOpenCode || hasOpenCodeJson || hasGit) {
        return current;
      }
    } catch {
      return null;
    }

    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }

  return null;
}

/**
 * Extract YAML frontmatter from a markdown file's content.
 */
function parseFrontmatter(content: string): Record<string, any> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const fm: Record<string, any> = {};
  for (const line of match[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.+)/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return fm;
}

/**
 * Detect project name from git root or directory name.
 */
function detectProjectName(projectDir: string): string {
  let projectName = path.basename(projectDir);
  // Prefer git repository name
  try {
    const gitToplevel = execSync("git rev-parse --show-toplevel", {
      cwd: projectDir,
      encoding: "utf-8",
    }).trim();
    projectName = path.basename(gitToplevel);
  } catch {
    // Fallback to directory name
  }
  return projectName;
}