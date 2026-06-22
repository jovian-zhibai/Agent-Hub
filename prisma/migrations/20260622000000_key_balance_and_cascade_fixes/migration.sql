-- ──────────────────────────────────────────────
-- Key balance tracking, FK cascade fixes, KeyBinding status enum,
-- and nullable failover FKs.
--
-- NOTE: token_version (accounts) and event_id (telemetry_logs)
-- were already added in migration 20260621000002 and are NOT
-- repeated here.
--
-- Fixes audit findings:
--   B3:  Key had no currentBalance/spent — server-side balance
--        tracking was impossible, so "auto-failover when key runs
--        out" had no data substrate.
--   B12: Deleting a Key failed or orphaned rows because
--        failover_logs.{from,to}_key_id were ON DELETE RESTRICT
--        and telemetry_logs.account_id / audit_logs.account_id
--        were ON DELETE RESTRICT instead of CASCADE.
-- ──────────────────────────────────────────────

-- 1. Key balance tracking ──────────────────────
-- current_balance mirrors initial_balance at backfill time; the
-- telemetry ingest path decrements it as cost accrues. NUMERIC(38,4)
-- matches the precision of other money columns.
ALTER TABLE "keys" ADD COLUMN "current_balance" NUMERIC(38,4);
UPDATE "keys"
  SET "current_balance" = "initial_balance"
  WHERE "current_balance" IS NULL AND "initial_balance" IS NOT NULL;

ALTER TABLE "keys" ADD COLUMN "spent" NUMERIC(38,4) NOT NULL DEFAULT 0;
ALTER TABLE "keys" ADD COLUMN "burn_rate_computed_at" TIMESTAMP(3);

-- 2. KeyBinding.status: text → enum ────────────
-- Existing values (active/standby/depleted/failed) all map cleanly.
CREATE TYPE "KeyBindingStatus" AS ENUM ('active', 'standby', 'depleted', 'failed');

ALTER TABLE "key_bindings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "key_bindings"
  ALTER COLUMN "status" TYPE "KeyBindingStatus"
  USING ("status"::text)::"KeyBindingStatus";
ALTER TABLE "key_bindings"
  ALTER COLUMN "status" SET DEFAULT 'standby'::"KeyBindingStatus";

-- 3. FailoverLog: nullable from/to key + ON DELETE SET NULL ──
-- A failover log should survive the deletion of one of its keys
-- (the row becomes historical evidence).
ALTER TABLE "failover_logs" ALTER COLUMN "from_key_id" DROP NOT NULL;
ALTER TABLE "failover_logs" ALTER COLUMN "to_key_id" DROP NOT NULL;

ALTER TABLE "failover_logs" DROP CONSTRAINT "failover_logs_from_key_id_fkey";
ALTER TABLE "failover_logs"
  ADD CONSTRAINT "failover_logs_from_key_id_fkey"
  FOREIGN KEY ("from_key_id") REFERENCES "keys"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "failover_logs" DROP CONSTRAINT "failover_logs_to_key_id_fkey";
ALTER TABLE "failover_logs"
  ADD CONSTRAINT "failover_logs_to_key_id_fkey"
  FOREIGN KEY ("to_key_id") REFERENCES "keys"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- 4. Cascade account deletion into telemetry/audit logs ──
-- Previously RESTRICT, so deleting an account exploded if it had
-- any telemetry (i.e. always). Now CASCADE cleans up.
ALTER TABLE "telemetry_logs" DROP CONSTRAINT "telemetry_logs_account_id_fkey";
ALTER TABLE "telemetry_logs"
  ADD CONSTRAINT "telemetry_logs_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs" DROP CONSTRAINT "audit_logs_account_id_fkey";
ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "accounts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Unique constraint on key labels per account ─────────────
-- Prevents the TOCTOU race in keys/route.ts POST (B17) at the DB
-- layer, independent of the application-level check.
CREATE UNIQUE INDEX "keys_account_id_key_label_key"
  ON "keys"("account_id", "key_label");
