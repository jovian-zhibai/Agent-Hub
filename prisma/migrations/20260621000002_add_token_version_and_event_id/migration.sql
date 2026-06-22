-- AlterTable: Add tokenVersion to accounts
ALTER TABLE "accounts" ADD COLUMN "token_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: Add eventId to telemetry_logs
ALTER TABLE "telemetry_logs" ADD COLUMN "event_id" TEXT;

-- Set eventId for existing rows (backfill based on available fields)
UPDATE "telemetry_logs"
SET "event_id" = CONCAT("agent_id", '::', EXTRACT(EPOCH FROM "reported_at") * 1000, '::', "event_type", '::', COALESCE("payload"->>'tool', 'unknown'), '::', COALESCE("payload"->>'model', 'unknown'))
WHERE "event_id" IS NULL;

-- Make eventId NOT NULL and UNIQUE
ALTER TABLE "telemetry_logs" ALTER COLUMN "event_id" SET NOT NULL;
ALTER TABLE "telemetry_logs" ADD CONSTRAINT "telemetry_logs_event_id_key" UNIQUE ("event_id");