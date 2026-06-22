#!/usr/bin/env node
/**
 * reset-monthly-spent.mjs
 *
 * Reset every agent's monthlySpent to 0 (run on the 1st of each month).
 *
 * Schedule (crontab / Vercel Cron / etc.):
 *   0 0 1 * *  node scripts/reset-monthly-spent.mjs
 *
 * Usage:
 *   node scripts/reset-monthly-spent.mjs
 *
 * Env:
 *   DATABASE_URL — Postgres connection string (required)
 */
import pg from "pg";

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error("✗ DATABASE_URL is required");
  process.exit(1);
}

const client = new pg.Client({ connectionString: DATABASE_URL });

try {
  await client.connect();
  const res = await client.query(
    `UPDATE agents SET monthly_spent = 0, updated_at = NOW()`,
  );
  console.log(`✓ Reset monthly_spent for ${res.rowCount} agent(s)`);
} catch (err) {
  console.error("✗ Failed to reset monthly_spent:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
