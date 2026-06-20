#!/bin/bash
# ──────────────────────────────────────────────
# Database Restore Script
# Restores PostgreSQL database from backup
# ──────────────────────────────────────────────

set -e

# Check if backup file provided
if [ -z "$1" ]; then
  echo "Usage: $0 <backup-file.sql.gz>"
  echo ""
  echo "Available backups:"
  ls -1t ./backups/agent-hub-*.sql.gz 2>/dev/null || echo "  No backups found"
  exit 1
fi

BACKUP_FILE="$1"

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL not set"
  exit 1
fi

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file not found: $BACKUP_FILE"
  exit 1
fi

# Confirm restoration
echo "⚠️  WARNING: This will REPLACE all data in the database!"
echo "Backup file: $BACKUP_FILE"
read -p "Are you sure? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Restore cancelled"
  exit 0
fi

# Decompress if needed
if [[ "$BACKUP_FILE" == *.gz ]]; then
  echo "Decompressing backup..."
  TEMP_FILE="/tmp/agent-hub-restore-$(date +%s).sql"
  gunzip -c "$BACKUP_FILE" > "$TEMP_FILE"
  RESTORE_FILE="$TEMP_FILE"
else
  RESTORE_FILE="$BACKUP_FILE"
fi

# Drop and recreate database (careful!)
echo "Dropping existing database..."
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Restore backup
echo "Restoring backup..."
psql "$DATABASE_URL" < "$RESTORE_FILE"

# Clean up temp file
if [ -n "$TEMP_FILE" ]; then
  rm "$TEMP_FILE"
fi

echo "✅ Database restored successfully"
echo "⚠️  Remember to run: npx prisma generate"
