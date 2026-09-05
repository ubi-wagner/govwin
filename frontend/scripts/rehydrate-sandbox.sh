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
TMPLOG="$(mktemp)"
trap 'rm -f "$TMPLOG"' EXIT
say "postgres: $(su postgres -c "psql -tAc 'select version()'" 2>/dev/null | head -c 25 || echo UNREACHABLE)"

# 2) role + database
su postgres -c "psql -tAc \"select 1 from pg_roles where rolname='govtech'\"" 2>/dev/null | grep -q 1 \
  || { say "creating role govtech"; su postgres -c "psql -c \"CREATE ROLE govtech LOGIN PASSWORD 'changeme' SUPERUSER;\"" >/dev/null 2>&1; }
su postgres -c "psql -tAc \"select 1 from pg_database where datname='govtech_intel'\"" 2>/dev/null | grep -q 1 \
  || { say "creating database govtech_intel"; su postgres -c "psql -c \"CREATE DATABASE govtech_intel OWNER govtech;\"" >/dev/null 2>&1; }

# 3) migrations (idempotent; 169/170 self-seed the Foundation demo)
#
# ── THIS STEP USED TO FAIL SILENTLY AND THE SCRIPT STILL SAID "state restored". ──
#
# It was `node migrate.mjs 2>&1 | tail -1`, which is wrong twice over. `tail -1` throws the error
# away — a crashed Node prints its stack and the LAST line is the banner "Node.js v22.22.2", so the
# log showed a version string where the reason should have been. And a pipeline's status is the
# status of its LAST command, so `$?` was tail's: a migration that never ran could not fail the
# script. Measured on a wiped box: zero tables in the database, and the script exited 0 announcing
# a restored sandbox.
#
# The failure it hid: migrate.mjs sits at the REPO ROOT and imports `postgres`, which resolves from
# a root node_modules. This environment reclaims node_modules, so after a reclaim the migrator
# cannot start at all — and nothing said so.
say "running migrations…"
if ! DATABASE_URL="$DBURL" node "$ROOT/db/migrations/migrate.mjs" > "$TMPLOG" 2>&1; then
  say "MIGRATIONS FAILED — the sandbox is NOT restored. Reason:"
  sed 's/^/    /' "$TMPLOG" | head -20
  if grep -q "ERR_MODULE_NOT_FOUND" "$TMPLOG"; then
    # The deps live in frontend/ — there is no package.json at the repo root, so `npm ci` there
    # does nothing and the next reader loses an hour. migrate.mjs sits at the root and imports
    # `postgres`, which Node resolves by walking UP from the file: /db/migrations → /db → / . None
    # of those carry node_modules, so the migrator can only start when the root install exists.
    say "  (a dependency is missing — run 'cd $FE && npm ci', then re-run this script)"
  fi
  exit 1
fi
sed 's/^/    /' "$TMPLOG" | tail -3

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
if ! DATABASE_URL_OWNER="$DBURL" node "$ROOT/scripts/sandbox-reset-passwords.mjs" > "$TMPLOG" 2>&1; then
  say "PASSWORD RESET FAILED — every /admin driver will die at the login form. Reason:"
  sed 's/^/    /' "$TMPLOG" | head -12
  exit 1
fi
sed 's/^/    /' "$TMPLOG" | tail -2

# 4) verify seed
# A '?' here means the query itself failed, which means the schema is not there — the old script
# printed it and carried on to announce success.
ATOMS=$(psql -h localhost -U govtech -d govtech_intel -tAc "select count(*) from library_atoms la join tenants t on t.id=la.tenant_id where t.slug='foundation'" 2>/dev/null || echo '?')
say "foundation atoms: $ATOMS"
if [ "$ATOMS" = "?" ]; then
  say "COULD NOT READ THE SEED — the database has no schema. NOT restored."
  exit 1
fi
say "logins — tenant: kate.ulepic@foundation3dp.com / DemoPass123!"
say "         admin:  eric@rfppipeline.com / ${SANDBOX_PASSWORD:-SandboxDrive2026!}"

# 5) build if MISSING **or OLDER THAN THE SOURCE**
#
# ⚠️ "The build exists" is not "the build is current", and the difference is invisible.
# A re-provisioned box re-clones the repo, so `git checkout` / a resync can move the SOURCE forward
# under a `.next/standalone` that is still perfectly self-consistent — same BUILD_ID top and
# staged, server boots, every page renders. What is missing is only the routes added since that
# build, and a route Next has never heard of is a 404 with no log line and no error surface.
#
# That is how a screenshot sweep photographed a customer-facing 404 on
# `/portal/[tenantSlug]/cards/[opportunityId]/solicitation` and read as a product defect: the page
# source was on disk, the route directory in the build output was EMPTY, and the BUILD_ID check
# below said MATCH because both halves came from the same stale build.
#
# So compare the newest source file against the build stamp. Cheap, and it fails in the safe
# direction: a spurious rebuild costs minutes, a stale build costs a false bug report.
NEWEST_SRC=$(find "$FE/app" "$FE/lib" "$FE/components" -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -newer "$STANDALONE/server.js" -print -quit 2>/dev/null)
if [ ! -f "$STANDALONE/server.js" ]; then
  say "no standalone build — running next build (slow)…"
  ( cd "$FE" && DATABASE_URL="$DBURL" npx next build >/dev/null 2>&1 )
elif [ -n "$NEWEST_SRC" ]; then
  say "build is OLDER than the source (e.g. ${NEWEST_SRC#$FE/}) — rebuilding (slow)…"
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
