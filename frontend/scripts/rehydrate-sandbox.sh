#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# rehydrate-sandbox — bring the demo box back after a VM reclaim / re-provision.
#
# A reclaimed VM comes up with the repo re-cloned but NO running services and NO
# database (fresh disk). This script is the one command that restores it:
#   1. start the PG16 cluster              5. build the app if the build is gone
#   2. ensure the govtech role + DB exist  6. stage static + public into standalone
#   3. run migrations (self-seed Foundation) 7. (re)start the server
#   4. verify the seed landed              8. verify login=200
# Idempotent: safe to re-run on an already-healthy box (each step no-ops).
# After this, launch the health-manager separately (it must be a background task):
#   Bash(run_in_background): INTERVAL=60 bash <scratchpad>/health-manager.sh
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
ROOT=/home/user/govwin
FE="$ROOT/frontend"
STANDALONE="$FE/.next/standalone"
DBURL='postgresql://govtech:changeme@localhost:5432/govtech_intel'
export PGPASSWORD=changeme
say() { echo "[rehydrate] $*"; }

# 1) Postgres cluster up
if ! psql -h localhost -U govtech -d postgres -tAc 'select 1' >/dev/null 2>&1 \
   && ! su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1; then
  say "starting PG16 cluster…"
  pg_ctlcluster 16 main start >/dev/null 2>&1 \
    || su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main -l /var/log/postgresql/postgresql-16-main.log start" >/dev/null 2>&1
  sleep 3
fi
say "postgres: $(su postgres -c "psql -tAc 'select version()'" 2>/dev/null | head -c 25 || echo UNREACHABLE)"

# 2) role + database
su postgres -c "psql -tAc \"select 1 from pg_roles where rolname='govtech'\"" 2>/dev/null | grep -q 1 \
  || { say "creating role govtech"; su postgres -c "psql -c \"CREATE ROLE govtech LOGIN PASSWORD 'changeme' SUPERUSER;\"" >/dev/null 2>&1; }
su postgres -c "psql -tAc \"select 1 from pg_database where datname='govtech_intel'\"" 2>/dev/null | grep -q 1 \
  || { say "creating database govtech_intel"; su postgres -c "psql -c \"CREATE DATABASE govtech_intel OWNER govtech;\"" >/dev/null 2>&1; }

# 3) migrations (idempotent; 169/170 self-seed the Foundation demo)
say "running migrations…"
DATABASE_URL="$DBURL" node "$ROOT/db/migrations/migrate.mjs" 2>&1 | tail -1

# 3b) ADMIN PASSWORDS — the step whose absence made every previous rehydrate half a restore.
#
# Migrations 124 and 198 deliberately rotate every seeded admin onto a random hash nobody holds,
# so a freshly-migrated box has NO usable admin login. The tenant users keep their seeded password
# (hence the banner below), which is why this gap hid: the box looks recovered, `kate.ulepic` signs
# in, and then every ADMIN driver — capture-guides, verify-surfaces, the award drive, any e2e that
# touches /admin — dies at the login form with a bare `/login?error=invalid`, which reads like
# broken auth rather than a missing setup step. Resetting here is the local stand-in for what a
# real operator does out-of-band after a deploy; it is sandbox-only and the script refuses a
# non-local DB.
say "resetting admin passwords…"
DATABASE_URL_OWNER="$DBURL" node "$ROOT/scripts/sandbox-reset-passwords.mjs" 2>&1 | tail -1

# 4) verify seed
ATOMS=$(psql -h localhost -U govtech -d govtech_intel -tAc "select count(*) from library_atoms la join tenants t on t.id=la.tenant_id where t.slug='foundation'" 2>/dev/null || echo '?')
say "foundation atoms: $ATOMS"
say "logins — tenant: kate.ulepic@foundation3dp.com / DemoPass123!"
say "         admin:  eric@rfppipeline.com / \${SANDBOX_PASSWORD:-SandboxDrive2026!}"

# 5) build if missing
if [ ! -f "$STANDALONE/server.js" ]; then
  say "no standalone build — running next build (slow)…"
  ( cd "$FE" && DATABASE_URL="$DBURL" npx next build >/dev/null 2>&1 )
fi

# 6) stage static + public (standalone keeps its own copies)
say "staging static + public…"
mkdir -p "$STANDALONE/public" && cp -r "$FE/public/." "$STANDALONE/public/" 2>/dev/null
rm -rf "$STANDALONE/.next/static" && cp -r "$FE/.next/static" "$STANDALONE/.next/static" 2>/dev/null

# 7) verify the build is staged (standalone keeps its own copies of static/public)
if [ -f "$STANDALONE/.next/BUILD_ID" ] && [ -f "$FE/.next/BUILD_ID" ]; then
  A=$(cat "$STANDALONE/.next/BUILD_ID"); B=$(cat "$FE/.next/BUILD_ID")
  say "build staged: standalone=$A top=$B ($([ "$A" = "$B" ] && echo MATCH || echo MISMATCH))"
fi

# The SERVER is owned by the health-manager, NOT this script: a server launched from a
# foreground call gets reaped when the call ends (only a run_in_background task persists).
# State is restored — now (re)launch the manager as a BACKGROUND task and it brings the
# server up within one tick:
#   SCR=<pad> INTERVAL=60 bash frontend/scripts/health-manager.sh   (run_in_background)
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000/login 2>/dev/null)
say "state restored (pg+db+build+stage). server /login → ${CODE:-000} ($([ "$CODE" = 200 ] && echo 'already up' || echo 'launch the health-manager to start it'))"
