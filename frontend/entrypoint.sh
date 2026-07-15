#!/bin/sh
set -e

# Run pending database migrations before starting the app.
# Uses the lightweight Node.js migration runner (no psql dependency).
if [ -f /app/db/migrations/migrate.mjs ]; then
  echo "[entrypoint] Running database migrations..."
  node /app/db/migrations/migrate.mjs
  echo "[entrypoint] Migrations complete."
fi

# Optionally seed dev/test accounts (two customer tenants + admin) and fully
# populate every active/trial tenant's pipeline from the bridge head. Idempotent.
# OPT-IN via SEED_DEV_ACCOUNTS=true so it NEVER runs in real prod unless the
# operator explicitly enables it (the seed uses default test passwords). Non-fatal:
# a seed failure must not crash-loop the app, so migrations+server still come up.
if [ "$SEED_DEV_ACCOUNTS" = "true" ] && [ -f /app/scripts/seed_dev_accounts.mjs ]; then
  echo "[entrypoint] SEED_DEV_ACCOUNTS=true — seeding dev accounts + tenant pipelines..."
  node /app/scripts/seed_dev_accounts.mjs || echo "[entrypoint] seed failed (non-fatal, continuing)"
  echo "[entrypoint] Seed step complete."
fi

# Marketing pages: CODE is the source of truth (we've backed off CMS editing for
# these — only genuinely dynamic content stays CMS-managed). When
# SEED_PAGE_CONTENT=true, push the build-time PAGE_SEEDS snapshot into content_pages
# so the public site matches the deployed code. Only touches the marketing pages in
# PAGE_SEEDS; dynamic content (blog/resource articles) is never touched. Non-fatal.
if [ "$SEED_PAGE_CONTENT" = "true" ] && [ -f /app/scripts/seed_page_content.mjs ]; then
  echo "[entrypoint] SEED_PAGE_CONTENT=true — syncing marketing pages from code..."
  node /app/scripts/seed_page_content.mjs || echo "[entrypoint] page-content seed failed (non-fatal, continuing)"
  echo "[entrypoint] Page-content sync complete."
fi

# Start Next.js
exec node server.js
