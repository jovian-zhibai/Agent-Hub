// ──────────────────────────────────────────────
// Agent Hub SDK — LocalCache
// 本地文件缓存，存储面板下发的配置到 ~/.agent-hub/
// ──────────────────────────────────────────────

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface CacheEntry<T> {
  version: number;
  expiresAt: number | null; // Unix timestamp (ms), null = never expires
  data: T;
  createdAt: number; // Unix timestamp (ms)
}

export interface CacheStats {
  recordCount: number;
  totalBytes: number;
  basePath: string;
}

// ──────────────────────────────────────────────
// Limits
// ──────────────────────────────────────────────

const MAX_RECORDS = 10_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_BYTES_WARN = 2 * 1024 * 1024; // 2 MB — warning threshold

// ──────────────────────────────────────────────
// LocalCache
// ──────────────────────────────────────────────

export class LocalCache {
  private ready: Promise<void>;

  constructor(private basePath: string = path.join(os.homedir(), ".agent-hub")) {
    this.ready = this.init();
  }

  // ── Lifecycle ────────────────────────────────

  /**
   * Ensure the cache directory exists.
   */
  private async init(): Promise<void> {
    await fs.mkdir(this.basePath, { recursive: true });
  }

  /**
   * Wait for initialization to complete before any operation.
   */
  private async ensureReady(): Promise<void> {
    await this.ready;
  }

  // ── Public API ───────────────────────────────

  /**
   * Retrieve a cached value by key.
   * Returns null if the key is missing, expired, or the file is corrupt.
   */
  async get<T>(key: string): Promise<T | null> {
    await this.ensureReady();
    const filePath = this.filePathForKey(key);

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const entry = this.parseEntry<T>(raw, key);
      if (entry === null) {
        return null;
      }
      // Check expiry
      if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
        await this.delete(key).catch(() => {});
        return null;
      }
      return entry.data;
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") {
        return null;
      }
      // Corrupt or unreadable — delete and return null
      await this.delete(key).catch(() => {});
      return null;
    }
  }

  /**
   * Write a value to the cache.
   * Sets version=1, no expiry.
   */
  async set<T>(key: string, value: T, options?: {
    version?: number;
    expiresAt?: number | null;
  }): Promise<void> {
    await this.ensureReady();
    await this.enforceLimits();

    const entry: CacheEntry<T> = {
      version: options?.version ?? 1,
      expiresAt: options?.expiresAt ?? null,
      data: value,
      createdAt: Date.now(),
    };

    const filePath = this.filePathForKey(key);
    const tmpPath = filePath + ".tmp";

    try {
      // Atomic write: write to .tmp, then rename
      await fs.writeFile(tmpPath, JSON.stringify(entry, null, 2), "utf-8");
      await fs.rename(tmpPath, filePath);
    } catch (err) {
      // Clean up temp file on failure
      await fs.unlink(tmpPath).catch(() => {});
      throw err;
    }
  }

  /**
   * Delete a single cached entry.
   */
  async delete(key: string): Promise<void> {
    await this.ensureReady();
    const filePath = this.filePathForKey(key);
    try {
      await fs.unlink(filePath);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === "ENOENT") {
        return; // Already gone — no-op
      }
      throw err;
    }
  }

  /**
   * Clear all cached entries in the base path.
   */
  async clear(): Promise<void> {
    await this.ensureReady();
    const entries = await fs.readdir(this.basePath, { withFileTypes: true });
    const removals = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => fs.unlink(path.join(this.basePath, entry.name)).catch(() => {}));

    await Promise.all(removals);
  }

  /**
   * Get cache statistics: record count and total byte size.
   */
  async getSize(): Promise<number> {
    await this.ensureReady();
    const entries = await fs.readdir(this.basePath, { withFileTypes: true });
    const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));

    if (jsonFiles.length === 0) {
      return 0;
    }

    const sizes = await Promise.all(
      jsonFiles.map(async (entry) => {
        try {
          const stat = await fs.stat(path.join(this.basePath, entry.name));
          return stat.size;
        } catch {
          return 0;
        }
      }),
    );

    return sizes.reduce((sum, s) => sum + s, 0);
  }

  /**
   * Get full stats including record count.
   */
  async stats(): Promise<CacheStats> {
    await this.ensureReady();
    const entries = await fs.readdir(this.basePath, { withFileTypes: true });
    const jsonFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));

    let totalBytes = 0;
    for (const entry of jsonFiles) {
      try {
        const stat = await fs.stat(path.join(this.basePath, entry.name));
        totalBytes += stat.size;
      } catch {
        // skip
      }
    }

    return {
      recordCount: jsonFiles.length,
      totalBytes,
      basePath: this.basePath,
    };
  }

  // ── Internal Helpers ─────────────────────────

  /**
   * Resolve the file path for a cache key.
   * P0 Bug 1 fix: Use template interpolation `{key}.json`.
   */
  private filePathForKey(key: string): string {
    return path.join(this.basePath, `${key}.json`);
  }

  /**
   * Parse a JSON string into a CacheEntry, with corruption detection.
   */
  private parseEntry<T>(raw: string, key: string): CacheEntry<T> | null {
    try {
      const parsed = JSON.parse(raw);

      // Validate structure
      if (typeof parsed !== "object" || parsed === null) {
        return null;
      }
      if (typeof parsed.version !== "number") {
        return null;
      }
      if (!("data" in parsed)) {
        return null;
      }
      if (parsed.expiresAt !== null && typeof parsed.expiresAt !== "number") {
        return null;
      }

      return parsed as CacheEntry<T>;
    } catch {
      // JSON parse failure = corruption
      return null;
    }
  }

  /**
   * Enforce cache size limits before writing:
   * - MAX_RECORDS (10,000)
   * - MAX_BYTES (5 MB)
   *
   * If exceeded, evict oldest entries first.
   */
  private async enforceLimits(): Promise<void> {
    const entries = await fs.readdir(this.basePath, { withFileTypes: true });
    const jsonFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => ({ name: e.name, fullPath: path.join(this.basePath, e.name) }));

    // Check record count
    if (jsonFiles.length >= MAX_RECORDS) {
      await this.evictOldest(jsonFiles, jsonFiles.length - MAX_RECORDS + 1);
    }

    // Check total bytes
    let totalBytes = 0;
    const filesWithSize: Array<{ name: string; fullPath: string; size: number; mtime: Date }> = [];

    for (const f of jsonFiles) {
      try {
        const stat = await fs.stat(f.fullPath);
        totalBytes += stat.size;
        filesWithSize.push({ ...f, size: stat.size, mtime: stat.mtime });
      } catch {
        // skip unreadable files
      }
    }

    if (totalBytes > MAX_BYTES) {
      filesWithSize.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());
      let bytesToFree = totalBytes - MAX_BYTES_WARN; // evict down to 2 MB
      for (const f of filesWithSize) {
        if (bytesToFree <= 0) break;
        try {
          await fs.unlink(f.fullPath);
          bytesToFree -= f.size;
        } catch {
          // skip
        }
      }
    }
  }

  /**
   * Evict the oldest N entries based on file mtime.
   */
  private async evictOldest(
    files: Array<{ name: string; fullPath: string }>,
    count: number,
  ): Promise<void> {
    const withMtime = await Promise.all(
      files.map(async (f) => {
        try {
          const stat = await fs.stat(f.fullPath);
          return { ...f, mtime: stat.mtime };
        } catch {
          return { ...f, mtime: new Date(0) };
        }
      }),
    );

    withMtime.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

    const toEvict = withMtime.slice(0, count);
    await Promise.all(toEvict.map((f) => fs.unlink(f.fullPath).catch(() => {})));
  }
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
