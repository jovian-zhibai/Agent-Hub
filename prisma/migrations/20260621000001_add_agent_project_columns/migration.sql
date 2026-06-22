-- Add missing project_name and project_path columns to agents table
-- These were defined in the Prisma schema but omitted from the initial migration

ALTER TABLE "agents" 
ADD COLUMN "project_name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "project_path" TEXT;

-- Add unique constraint matching Prisma schema @@unique([accountId, projectPath, name])
CREATE UNIQUE INDEX "agents_account_id_project_path_name_key" ON "agents"("account_id", "project_path", "name");
