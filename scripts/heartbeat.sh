#!/usr/bin/env bash
# Foundation test-sandbox heartbeat — keep postgres (:5433) + the Next.js server (:3000) alive
# so the seeded Foundation/TVSF instance stays reachable for testing. Self-contained + idempotent
# (safe to run every few minutes). No `sleep` (uses pg_ctl -w and curl --retry) so it runs clean
# in the foreground. Prints one HEARTBEAT status line.
export DATABASE_URL='postgresql://claude@127.0.0.1:5433/govtech_intel'
FE=/home/user/govwin/frontend
ROOT=/home/user/govwin

# 1) postgres — restart on the persistent data dir if it's not accepting connections
if pg_isready -h 127.0.0.1 -p 5433 -q 2>/dev/null; then
  PG=up
elif [ -d /tmp/pgs_gov/data ]; then
  rm -f /tmp/pgs_gov/data/postmaster.pid 2>/dev/null
  mkdir -p /tmp/pgs_sock 2>/dev/null; chown -R claude:claude /tmp/pgs_gov /tmp/pgs_sock 2>/dev/null
  su claude -c "/usr/lib/postgresql/16/bin/pg_ctl -w -t 30 -D /tmp/pgs_gov/data -o '-p 5433 -k /tmp/pgs_sock' -l /tmp/pgs_gov/log start" >/dev/null 2>&1 \
    || /usr/lib/postgresql/16/bin/pg_ctl -w -t 30 -D /tmp/pgs_gov/data -o '-p 5433 -k /tmp/pgs_sock' -l /tmp/pgs_gov/log start >/dev/null 2>&1
  pg_isready -h 127.0.0.1 -p 5433 -q 2>/dev/null && PG=restarted || PG=RESTART_FAILED
else
  PG=DATA_GONE   # full container reclaim — needs a rebuild+reseed (see FOUNDATION_TVSF_SEED.md)
fi

# 2) server — restart the standalone build if /api/health isn't 200
CODE=$(curl -s -o /dev/null -m 8 -w '%{http_code}' http://localhost:3000/api/health 2>/dev/null || echo 000)
if [ "$CODE" = "200" ]; then
  SRV=up
elif [ -f "$FE/.next/standalone/server.js" ]; then
  [ -e "$ROOT/node_modules" ] || ln -sfn frontend/node_modules "$ROOT/node_modules"
  if [ ! -d "$FE/.next/standalone/.next/static" ]; then
    mkdir -p "$FE/.next/standalone/.next"; cp -r "$FE/.next/static" "$FE/.next/standalone/.next/" 2>/dev/null
    [ -d "$FE/public" ] && cp -r "$FE/public" "$FE/.next/standalone/" 2>/dev/null
  fi
  pkill -9 -f next-server 2>/dev/null; fuser -k -9 3000/tcp 2>/dev/null
  ( cd "$FE" && PORT=3000 HOSTNAME=127.0.0.1 \
      DATABASE_URL="$DATABASE_URL" AUTH_SECRET='dev-screenshot-secret-000' AUTH_TRUST_HOST=true \
      NEXTAUTH_URL='http://localhost:3000' AUTH_URL='http://localhost:3000' ANTHROPIC_API_KEY='sk-noop' \
      NODE_ENV=production AWS_S3_BUCKET_NAME='rfp-pipeline-local' AWS_REGION='us-east-1' \
      setsid node .next/standalone/server.js >/tmp/next-app.log 2>&1 < /dev/null & )
  CODE=$(curl -s -o /dev/null -m 25 --retry 20 --retry-delay 1 --retry-connrefused -w '%{http_code}' http://localhost:3000/api/health 2>/dev/null || echo 000)
  [ "$CODE" = "200" ] && SRV=restarted || SRV=RESTART_FAILED
else
  SRV=NO_BUILD    # .next/standalone gone — needs a rebuild
fi

# 3) sanity — Foundation tenant present?
TEN=$(psql "$DATABASE_URL" -tAc "SELECT slug FROM tenants WHERE slug='foundation'" 2>/dev/null | tr -d '[:space:]')
echo "HEARTBEAT $(date -u '+%Y-%m-%d %H:%M UTC') pg=$PG server=$SRV code=$CODE foundation=${TEN:-MISSING}"
