-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('running', 'idle', 'disabled', 'offline', 'error');

-- CreateEnum
CREATE TYPE "KeyHealth" AS ENUM ('normal', 'warning', 'critical', 'rate_limited', 'invalid', 'stale');

-- CreateEnum
CREATE TYPE "KeyScope" AS ENUM ('personal', 'workspace');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('tool_call', 'token_usage', 'permission_denied', 'key_health', 'heartbeat', 'key_failover', 'agent_enabled', 'agent_disabled');

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "framework" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'running',
    "machine_id" TEXT,
    "safety_mode" BOOLEAN NOT NULL DEFAULT false,
    "monthly_budget" DECIMAL(65,30),
    "monthly_spent" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "supported_protocols" JSONB NOT NULL,
    "base_urls" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "keys" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "protocol" TEXT NOT NULL DEFAULT 'openai',
    "key_label" TEXT NOT NULL,
    "key_encrypted" TEXT NOT NULL,
    "key_prefix" TEXT,
    "scope" "KeyScope" NOT NULL,
    "workspace_id" TEXT,
    "group" TEXT,
    "note" TEXT,
    "initial_balance" DECIMAL(65,30),
    "balance_note" TEXT,
    "health" "KeyHealth" NOT NULL DEFAULT 'normal',
    "burn_rate" DECIMAL(65,30),
    "last_tested_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "key_bindings" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "key_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "key_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "safety_mode" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "models" (
    "id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "default_protocol" TEXT NOT NULL DEFAULT 'openai',
    "supported_protocols" JSONB NOT NULL,
    "model_name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "pricing_input" DECIMAL(65,30) NOT NULL,
    "pricing_output" DECIMAL(65,30) NOT NULL,
    "pricing_as_of" TIMESTAMP(3),
    "pricing_source" TEXT NOT NULL DEFAULT 'unknown',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_logs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "key_id" TEXT,
    "account_id" TEXT NOT NULL,
    "event_type" "EventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL,
    "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_hourly" (
    "agent_id" TEXT NOT NULL,
    "hour" TIMESTAMP(3) NOT NULL,
    "tool_calls" INTEGER NOT NULL DEFAULT 0,
    "tokens_input" BIGINT NOT NULL DEFAULT 0,
    "tokens_output" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "permissions_denied" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "telemetry_hourly_pkey" PRIMARY KEY ("agent_id","hour")
);

-- CreateTable
CREATE TABLE "telemetry_daily" (
    "agent_id" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "tool_calls" INTEGER NOT NULL DEFAULT 0,
    "tokens_input" BIGINT NOT NULL DEFAULT 0,
    "tokens_output" BIGINT NOT NULL DEFAULT 0,
    "cost" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "permissions_denied" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "telemetry_daily_pkey" PRIMARY KEY ("agent_id","day")
);

-- CreateTable
CREATE TABLE "failover_logs" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "from_key_id" TEXT NOT NULL,
    "to_key_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "failover_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "operator_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE INDEX "agents_account_id_status_idx" ON "agents"("account_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "providers_name_key" ON "providers"("name");

-- CreateIndex
CREATE INDEX "keys_account_id_provider_id_idx" ON "keys"("account_id", "provider_id");

-- CreateIndex
CREATE INDEX "key_bindings_agent_id_priority_idx" ON "key_bindings"("agent_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "key_bindings_agent_id_key_id_key" ON "key_bindings"("agent_id", "key_id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_agent_id_key" ON "permissions"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "models_provider_id_model_name_key" ON "models"("provider_id", "model_name");

-- CreateIndex
CREATE INDEX "telemetry_logs_agent_id_reported_at_idx" ON "telemetry_logs"("agent_id", "reported_at" DESC);

-- CreateIndex
CREATE INDEX "telemetry_logs_key_id_reported_at_idx" ON "telemetry_logs"("key_id", "reported_at" DESC);

-- CreateIndex
CREATE INDEX "telemetry_logs_event_type_reported_at_idx" ON "telemetry_logs"("event_type", "reported_at" DESC);

-- CreateIndex
CREATE INDEX "telemetry_logs_account_id_reported_at_idx" ON "telemetry_logs"("account_id", "reported_at" DESC);

-- CreateIndex
CREATE INDEX "failover_logs_agent_id_triggered_at_idx" ON "failover_logs"("agent_id", "triggered_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_account_id_created_at_idx" ON "audit_logs"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keys" ADD CONSTRAINT "keys_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "keys" ADD CONSTRAINT "keys_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_bindings" ADD CONSTRAINT "key_bindings_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "key_bindings" ADD CONSTRAINT "key_bindings_key_id_fkey" FOREIGN KEY ("key_id") REFERENCES "keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "models" ADD CONSTRAINT "models_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "providers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_logs" ADD CONSTRAINT "telemetry_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_logs" ADD CONSTRAINT "telemetry_logs_key_id_fkey" FOREIGN KEY ("key_id") REFERENCES "keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_logs" ADD CONSTRAINT "telemetry_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_hourly" ADD CONSTRAINT "telemetry_hourly_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_daily" ADD CONSTRAINT "telemetry_daily_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failover_logs" ADD CONSTRAINT "failover_logs_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failover_logs" ADD CONSTRAINT "failover_logs_from_key_id_fkey" FOREIGN KEY ("from_key_id") REFERENCES "keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "failover_logs" ADD CONSTRAINT "failover_logs_to_key_id_fkey" FOREIGN KEY ("to_key_id") REFERENCES "keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
