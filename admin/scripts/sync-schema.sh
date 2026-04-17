#!/bin/bash
# Sync Prisma schema from admin (source of truth) to user-side
# Usage: ./scripts/sync-schema.sh /path/to/creator_mmfc/web

set -e

TARGET_DIR="${1:?Usage: $0 <path-to-user-web-dir>}"
SOURCE_SCHEMA="$(dirname "$0")/../prisma/schema.prisma"

if [ ! -f "$SOURCE_SCHEMA" ]; then
  echo "Error: Source schema not found at $SOURCE_SCHEMA"
  exit 1
fi

if [ ! -d "$TARGET_DIR/prisma" ]; then
  echo "Error: Target prisma directory not found at $TARGET_DIR/prisma"
  exit 1
fi

echo "Syncing schema to $TARGET_DIR/prisma/schema.prisma"
echo "Note: Admin-only models (AdminUser, AuditLog) will be included but"
echo "      the user-side app only uses models it imports."

cp "$SOURCE_SCHEMA" "$TARGET_DIR/prisma/schema.prisma"

echo "Running prisma generate in user-side..."
cd "$TARGET_DIR" && npx prisma generate

echo "Done. User-side schema synced."
