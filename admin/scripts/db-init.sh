#!/bin/sh
set -e
cd /app

PUSH_FLAGS=""
if [ "${PRISMA_ACCEPT_DATA_LOSS:-0}" = "1" ]; then
  PUSH_FLAGS="--accept-data-loss"
  echo "[db-init] prisma db push with --accept-data-loss (development only)"
fi

npx prisma db push --schema=./prisma/schema.prisma $PUSH_FLAGS
npx tsx prisma/seed.ts

if [ "${SEED_PROMPTS_FROM_CODE:-0}" = "1" ]; then
  echo "[db-init] SEED_PROMPTS_FROM_CODE=1: running seed-prompts"
  npx tsx scripts/seed-prompts.ts
else
  echo "[db-init] Skipping seed-prompts (preserve DB prompt templates; set SEED_PROMPTS_FROM_CODE=1 to sync from codebase)"
fi
