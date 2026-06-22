#!/usr/bin/env node
/**
 * cleanup-telemetry.mjs
 *
 * Prune old rows from telemetry_logs to keep the raw-event table
 * bounded. Aggregated rollups (telemetry_hourly / telemetry_daily)
 * are kept indefinitely so historical cost trends survive.
 *
 * Default retention: 90 days. Override with RETENTION_DAYS.
 *
 * Schedule (crontab / Vercel Cron / etc.):
 *   0 3 * * *  node scripts/cleanup-telemetry.mjs
 *
 * Env:
 *   DATABASE_URL    — Postgres connection string (required)
 *   RETENTION_DAYS  — days of raw logs to keep (default: 90)
 */
import pg from "pg";

const { DATABASE_URL, RETENTION_DAYS = "90" } = process.env;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL is required");
  process.exit(1);
}

const days = Number.parseInt(RETENTION_DAYS, 10);
if (!Number.isFinite(days) || days <= 0) {
  console.error(`✗ RETENTION_DAYS must be a positive integer, got "${RETENTION_DAYS}"`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
  // Delete in batches to avoid a single huge transaction locking the table.
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let totalDeleted = 0;
  const BATCH = 5000;
  for (;;) {
    const res = await client.query(
      `DELETE FROM telemetry_logs
       WHERE id IN (
         SELECT id FROM telemetry_logs
         WHERE reported_at < $1
         ORDER BY reported_at
         LIMIT $2
       )`,
      [cutoff, BATCH],
    );
    totalDeleted += res.rowCount;
    process.stdout.write(`  deleted ${res.rowCount} (cumulative ${totalDeleted})\n`);
    if (res.rowCount < BATCH) break;
  }
  console.log(`✓ Pruned ${totalDeleted} telemetry_log row(s) older than ${days} day(s)`);
} catch (err) {
  console.error("✗ Telemetry cleanup failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
