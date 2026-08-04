#!/usr/bin/env bash
# Serve the built standalone app for the E2E suite WITH the founding-cohort paywall bypass.
#
# The specs matrix/lock/fullloop/atomloop hit the deliberately-paywalled
# /api/portal/<t>/proposals/create direct-hook (402 by design). The real product path
# (purchase→release) needs NO bypass — but those direct-hook specs do, so serving the
# suite requires FOUNDING_COHORT_BYPASS=true. heartbeat.sh does NOT set it (prod never
# should) — this script is the E2E-only serve front door (punch list C1).
#
# Runs the server in the FOREGROUND (launch it as a background job / with setsid). Stages
# .next/static + public into standalone first (next start is broken here — CLAUDE.md).
# Usage:  DATABASE_URL=<db> bash scripts/serve-e2e.sh   (add & or run detached)
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FE="$ROOT/frontend"
export DATABASE_URL="${DATABASE_URL:-postgresql://claude@127.0.0.1:5433/govtech_intel}"

[ -f "$FE/.next/standalone/server.js" ] || { echo "[serve-e2e] no standalone build — run 'cd frontend && npx next build' first" >&2; exit 1; }
[ -e "$ROOT/node_modules" ] || ln -sfn frontend/node_modules "$ROOT/node_modules"

# stage static + public (idempotent)
if [ ! -d "$FE/.next/standalone/.next/static" ]; then
  mkdir -p "$FE/.next/standalone/.next"
  cp -r "$FE/.next/static" "$FE/.next/standalone/.next/" 2>/dev/null || true
  [ -d "$FE/public" ] && cp -r "$FE/public" "$FE/.next/standalone/" 2>/dev/null || true
fi

# free port 3000
pkill -9 -f "standalone/server.js" 2>/dev/null || true
fuser -k -9 3000/tcp 2>/dev/null || true

cd "$FE" || exit 1
exec env \
  PORT=3000 HOSTNAME=127.0.0.1 \
  DATABASE_URL="$DATABASE_URL" \
  AUTH_SECRET="${AUTH_SECRET:-dev-screenshot-secret-000}" AUTH_TRUST_HOST=true \
  NEXTAUTH_URL="http://localhost:3000" AUTH_URL="http://localhost:3000" \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-sk-noop}" \
  NODE_ENV=production AWS_S3_BUCKET_NAME="rfp-pipeline-local" AWS_REGION="us-east-1" \
  FOUNDING_COHORT_BYPASS=true \
  node .next/standalone/server.js
