#!/bin/sh
set -e

# ── Migrations run HERE, inside the deployment, before the app serves anything ────────────────
#
# `set -e` above means a failed migration stops the boot. That is deliberate: a server answering
# requests against a schema it does not match is worse than a server that will not start.
#
# ⚠️ THE ROLE MATTERS, AND GETTING IT WRONG CRASH-LOOPS THE DEPLOY.
#
# `migrate.mjs` reads DATABASE_URL, and on this service DATABASE_URL is `govtech_app` — the
# NOBYPASSRLS application role, which is correct for serving and WRONG for migrating. Any migration
# that references a table the app role does not own fails with:
#
#     permission denied for table tenants
#
# …which reads like a problem with `tenants`. Migrations 215, 216 and 217 all carry
# `REFERENCES tenants(id)`, so without the owner connection the next deploy does not come up.
#
# So: migrate as the OWNER, serve as the app role. Same split scripts/sandbox-env.sh documents.
MIGRATE_URL="${DATABASE_URL_OWNER:-$DATABASE_URL}"
if [ -z "$DATABASE_URL_OWNER" ]; then
  echo "[entrypoint] ⚠️  DATABASE_URL_OWNER is NOT SET — migrating as the application role."
  echo "[entrypoint]    Any migration needing an owner privilege will fail with a message about"
  echo "[entrypoint]    the wrong table. Set DATABASE_URL_OWNER on this service."
fi

if [ -f /app/db/migrations/migrate.mjs ]; then
  echo "[entrypoint] Running database migrations..."
  DATABASE_URL="$MIGRATE_URL" node /app/db/migrations/migrate.mjs
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
