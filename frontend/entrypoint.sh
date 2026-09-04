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
# NOBYPASSRLS application role, which is correct for serving and WRONG for migrating.
#
# This used to surface as `permission denied for table tenants` — a DDL migration hitting a table
# the app role does not own, reading like a problem with `tenants`. That was never the worst case.
# A DATA-REPAIR migration needs no privilege at all: under FORCE-RLS with no tenant context its
# UPDATE matches zero rows, raises nothing, and is recorded as applied — permanently. Migration 245
# was lost exactly that way. So `migrate.mjs` now REFUSES up front as any role that can neither
# `rolsuper` nor `rolbypassrls`, and with `set -e` above that refusal stops the boot.
#
# Read that consequence plainly: with DATABASE_URL_OWNER unset, THIS DEPLOY DOES NOT START. That is
# the intended outcome — a schema silently half-applied is worse — but it means the variable is a
# hard prerequisite, not a nice-to-have that merely dims the admin consoles.
#
# So: migrate as the OWNER, serve as the app role. Same split scripts/sandbox-env.sh documents.
MIGRATE_URL="${DATABASE_URL_OWNER:-$DATABASE_URL}"
if [ -z "$DATABASE_URL_OWNER" ]; then
  echo "[entrypoint] ⛔ DATABASE_URL_OWNER is NOT SET — migrating as the application role."
  echo "[entrypoint]    migrate.mjs refuses to run as a role that cannot bypass RLS, so the next"
  echo "[entrypoint]    line is a refusal and THIS CONTAINER WILL NOT START. That is deliberate."
  echo "[entrypoint]    Set DATABASE_URL_OWNER on this service to the owner connection string."
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
