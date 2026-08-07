#!/usr/bin/env bash
#
# replicate-vm.sh — one command to (re)build the Claude dev VM to the canonical V1 baseline:
#   Postgres sandbox  →  all migrations (schema + seeds, incl. the two partner-managers)
#   →  known dev passwords  →  built standalone app  →  served on :3000  →  login smoke-tests.
#
# Idempotent + restart-safe: run it after every container reclaim (which reverts the git tree
# and the sandbox DB). It only re-does what's stale. See docs/CLAUDE_VM_REPLICATION.md.
#
# DEV ONLY. It sets known passwords on demo accounts — never run against a real database.
set -uo pipefail

ROOT="${ROOT:-/home/user/govwin}"
FRONTEND="$ROOT/frontend"
PGBIN=/usr/lib/postgresql/16/bin
PGDATA=/tmp/pgs_gov/data
PGSOCK=/tmp/pgs_gov
PGPORT=5433
DB=govtech_intel
DEV_PW="${DEV_PW:-DemoPass123!}"
export DATABASE_URL="postgresql://claude@127.0.0.1:${PGPORT}/${DB}"
say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

# 0. Recover the git tree to the pushed branch (a reclaim reverts local HEAD).
say "Sync git tree"
git -C "$ROOT" fetch origin claude/nice-hamilton-kBqtD --quiet && \
  git -C "$ROOT" reset --hard origin/claude/nice-hamilton-kBqtD --quiet && \
  echo "HEAD = $(git -C "$ROOT" log --oneline -1)"

# 1. Postgres — init if the data dir is gone, then start.
say "Postgres"
if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "initializing a fresh cluster"
  mkdir -p "$PGSOCK"; chown claude "$PGSOCK" 2>/dev/null || true
  su claude -c "$PGBIN/initdb -D $PGDATA -U claude" >/dev/null
  su claude -c "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k $PGSOCK' -l $PGSOCK/pg.log start"
  until pg_isready -h 127.0.0.1 -p $PGPORT >/dev/null 2>&1; do sleep 1; done
  createdb -h 127.0.0.1 -p $PGPORT -U claude "$DB"
else
  pg_isready -h 127.0.0.1 -p $PGPORT >/dev/null 2>&1 || \
    su claude -c "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k $PGSOCK' -l $PGSOCK/pg.log start"
  until pg_isready -h 127.0.0.1 -p $PGPORT >/dev/null 2>&1; do sleep 1; done
fi
echo "PG up on $PGPORT"

# 2. Migrations — idempotent; brings schema + seeds (incl. partners) current.
say "Migrations"
node "$ROOT/db/migrations/migrate.mjs"

# 3. Known dev passwords on the demo actors (temp_password accounts otherwise force a reset).
say "Demo passwords ($DEV_PW)"
HASH=$(node -e "console.log(require('$FRONTEND/node_modules/bcryptjs').hashSync(process.argv[1],10))" "$DEV_PW")
psql "$DATABASE_URL" -q -c "UPDATE users SET password_hash='$HASH', temp_password=false, is_active=true
  WHERE email IN ('pjackson@ecinnovates.com','sgaffney@ybi.org',
                  'e2e-rfpadmin@rfppipeline.test','e2e-master@rfppipeline.test');"
psql "$DATABASE_URL" -tAc "SELECT email, role FROM users
  WHERE email IN ('pjackson@ecinnovates.com','sgaffney@ybi.org','e2e-rfpadmin@rfppipeline.test') ORDER BY role;"

# 4. Build + stage + serve the standalone app (next start is broken under output:'standalone').
say "Build + serve"
cd "$FRONTEND"
npx next build
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public 2>/dev/null || true
fuser -k 3000/tcp 2>/dev/null || true; sleep 1
( cd .next/standalone && setsid env PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production \
    DATABASE_URL="$DATABASE_URL" AUTH_SECRET="${AUTH_SECRET:-dev-screenshot-secret-000}" AUTH_TRUST_HOST=true \
    NEXTAUTH_URL='http://localhost:3000' AUTH_URL='http://localhost:3000' ANTHROPIC_API_KEY='sk-noop' \
    AWS_S3_BUCKET_NAME='rfp-pipeline-local' AWS_REGION='us-east-1' PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    node server.js > /tmp/vm-server.log 2>&1 < /dev/null & )
until curl -s -o /dev/null http://localhost:3000/login; do sleep 1; done
echo "served on http://localhost:3000 (build $(cat .next/BUILD_ID))"

# 5. Smoke: the two partners + an admin authenticate and carry the right role.
say "Login smoke"
cd "$FRONTEND"
TEST_BASE_URL=http://localhost:3000 E2E_PARTNER_PW="$DEV_PW" PW_CHROMIUM_PATH=/opt/pw-browsers/chromium \
  PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test --project=hitl hitl-partner-manager --reporter=line || \
  echo "(partner-manager e2e needs the server — see /tmp/vm-server.log if it failed)"

say "VM replicated → http://localhost:3000  (Paul: pjackson@ecinnovates.com · Stephanie: sgaffney@ybi.org · pw: $DEV_PW)"
