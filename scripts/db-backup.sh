#!/bin/bash
# ──────────────────────────────────────────────
# Database Backup Script
# Creates timestamped PostgreSQL backups
# ──────────────────────────────────────────────

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/agent-hub-$DATE.sql"

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL not set"
  exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Create backup
echo "Creating backup: $BACKUP_FILE"
pg_dump "$DATABASE_URL" > "$BACKUP_FILE"

# Compress backup
echo "Compressing backup..."
gzip "$BACKUP_FILE"

# Keep only last 7 backups
echo "Cleaning old backups..."
ls -t "$BACKUP_DIR"/agent-hub-*.sql.gz | tail -n +8 | xargs -r rm

echo "✅ Backup completed: $BACKUP_FILE.gz"
