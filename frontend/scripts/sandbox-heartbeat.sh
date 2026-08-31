#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# sandbox-heartbeat — SOP keep-alive manager for the demo/test sandbox.
#
# ⭐ SOP: launch this as a BACKGROUND task at the START of every working session, and
#    keep it running the whole time. A foreground launch gets reaped when the call ends —
#    it MUST be a run_in_background task so it persists across turns.
#      Bash(run_in_background):  INTERVAL=20 SCR=<scratchpad> bash frontend/scripts/sandbox-heartbeat.sh
#    With the emulated-Claude test loop (drives the AI-gated flows end-to-end, no live key):
#      Bash(run_in_background):  INTERVAL=20 EMULATE=1 SCR=<scratchpad> bash frontend/scripts/sandbox-heartbeat.sh
#
# Every INTERVAL seconds it hits the DB + services with a heartbeat and auto-repairs what it can:
#   • Postgres (govtech_intel)  — SELECT 1 keeps the connection warm + the cluster hydrated; starts the
#                                 PG16 cluster if it's down (the DATA persists on disk across a process kill)
#   • emulated-Claude (:8787)   — [EMULATE=1] /health; restarts the committed test-harness emulator if down
#   • frontend server (:3000)   — /login must be 200; restarts from the standalone build (WITH the emulate
#                                 env when EMULATE=1, so the AI loop + local storage survive) — never
#                                 double-starts if something already owns :3000
#   • the pad (SCR)             — writes a heartbeat file so the scratchpad stays warm
#
# The frequent DB ping keeps it hydrated; the running loop keeps the VM active (fewer idle reaps). It
# CANNOT prevent a full VM reclaim (a platform inactivity behavior — no pin option); on one it flags
# `needs-rehydrate` in the status so recovery is `bash frontend/scripts/rehydrate-sandbox.sh`.
# Status: $SCR/health-status.txt (one line) + $SCR/health.log (append, bounded).
# ─────────────────────────────────────────────────────────────────────────────
set -u
ROOT=/home/user/govwin
FE="$ROOT/frontend"
STANDALONE="$FE/.next/standalone"
HARNESS="$FE/scripts/test-harness"
SCR="${SCR:-/tmp/govwin-sandbox}"
# PROD-FAITHFUL BY DEFAULT (CLAUDE.md: "the sandbox EMULATES PRODUCTION EXACTLY — serve as
# govtech_app with RLS on"). The app connects as the NOBYPASSRLS `govtech_app` role so RLS is
# actually ENFORCED here, and sqlBypass gets the owner via DATABASE_URL_OWNER. Serving as the
# superuser instead (the old behaviour) silently bypasses every policy, which hides the entire
# missing-enterTenant bug class from tsc/vitest/live testing — a class that then only shows up in
# production as 0 rows / 404 / RLS-violation. Set RLS_FAITHFUL=0 to fall back to the superuser.
#
# ── ONE CREDENTIAL, ONE PLACE — occurrence FIVE ──────────────────────────────────────────────
# These two URLs used to be literals here, and `DBURL_APP` carried `changeme` (the OWNER's
# password) for the `govtech_app` role, whose password in scripts/sandbox-env.sh is `apppass`.
# The heartbeat therefore started the app server with a DATABASE_URL that cannot authenticate,
# and every sign-in answered `login?error=invalid` — which reads as a broken product flow and is
# two files disagreeing about one value. The server log said so plainly
# (`password authentication failed for user "govtech_app"`); nothing else did, and every lens
# died at its first login. That is B146/B147 for the fifth time, so: RESOLVE FROM sandbox-env.sh,
# which is the one place that owns these, and keep the literals only as a fallback for a caller
# that has no repo checkout.
if [ -f "$ROOT/scripts/sandbox-env.sh" ]; then
  # shellcheck disable=SC1091
  . "$ROOT/scripts/sandbox-env.sh" >/dev/null 2>&1 || true
fi
DBURL_OWNER="${DATABASE_URL_OWNER:-postgresql://govtech:changeme@localhost:5432/govtech_intel}"
DBURL_APP="${DATABASE_URL:-postgresql://govtech_app:apppass@localhost:5432/govtech_intel}"
if [ "${RLS_FAITHFUL:-1}" = "1" ]; then DBURL="$DBURL_APP"; else DBURL="$DBURL_OWNER"; fi
INTERVAL="${INTERVAL:-20}"
EMULATE="${EMULATE:-0}"
EMU_PORT="${EMU_PORT:-8787}"
# Derived from DBURL_OWNER for the same reason as above.
export PGPASSWORD="$(printf '%s' "$DBURL_OWNER" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')"
mkdir -p "$SCR"
LOG="$SCR/health.log"; STATUS="$SCR/health-status.txt"; HEART="$SCR/.heartbeat"; EMU_LOG="$SCR/emulated-claude.log.jsonl"

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }

emu_env() { [ "$EMULATE" = "1" ] && echo "ANTHROPIC_BASE_URL=http://127.0.0.1:${EMU_PORT} ANTHROPIC_API_KEY=emulated-claude"; }
start_server() {
  ( cd "$STANDALONE" && env \
      DATABASE_URL="$DBURL" DATABASE_URL_OWNER="$DBURL_OWNER" \
      AUTH_SECRET='dev-screenshot-secret-000' AUTH_TRUST_HOST=true \
      NEXTAUTH_URL='http://localhost:3000' AUTH_URL='http://localhost:3000' \
      PORT=3000 HOSTNAME=127.0.0.1 NODE_ENV=production \
      FOUNDING_COHORT_BYPASS=true ATOM_EMBED=local STORAGE_DRIVER=local \
      LOCAL_STORAGE_DIR=/tmp/govwin-storage AWS_S3_BUCKET=rfp-pipeline-local AWS_REGION=us-east-1 \
      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers $(emu_env) \
      node server.js >> "$SCR/server.log" 2>&1 & )
}
start_pg() {
  pg_ctlcluster 16 main start >/dev/null 2>&1 \
    || su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main -l /var/log/postgresql/postgresql-16-main.log start" >/dev/null 2>&1
}
start_emu() { ( LOG="$EMU_LOG" PORT="$EMU_PORT" node "$HARNESS/emulated-claude.mjs" >> "$SCR/emu.out" 2>&1 & ); }

# Is anything listening on $1? `ss` is NOT installed in this container, so the original
# `ss -ltn | grep :3000` guard ALWAYS failed — the "never double-starts" promise in the header was
# not kept. During a slow Next boot (several seconds) every cycle saw a non-200 /login, found no
# listener, and spawned ANOTHER server; they then fought over :3000. fuser is present; ss stays as
# a fallback for hosts that have it instead.
port_busy() {
  fuser -n tcp "$1" >/dev/null 2>&1 && return 0
  command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$1" && return 0
  return 1
}

# The pipeline worker — the component that actually RUNS the workflows. It was not supervised
# here, so it could die and every heartbeat still read healthy: db ok, srv ok, emu ok, and no
# automation running at all. That is the worst shape a monitor can have.
#
# Runs as the OWNER connection, not govtech_app: it is the cross-tenant engine, so one connection
# cannot carry one tenant's RLS context (docs/RLS_CUTOVER.md — "pipeline = owner"). Started as
# govtech_app, every workflow dies writing process_instances.
start_worker() {
  ( cd "$ROOT/pipeline" && env \
      DATABASE_URL="$DBURL_OWNER" PYTHONPATH=src \
      $(emu_env) \
      setsid python3 src/main.py >> "$SCR/worker.log" 2>&1 & )
}

cycle=0
echo "$(ts) sandbox-heartbeat started (pid $$, interval ${INTERVAL}s, emulate=${EMULATE}, scr=$SCR)" >> "$LOG"
while true; do
  cycle=$((cycle + 1))
  if echo "alive $(ts) cycle=$cycle" > "$HEART" 2>/dev/null; then PAD=ok; else PAD=FAIL; fi

  # ── db (keep hydrated; restart the cluster if the process died — data survives on disk) ──
  if psql -h localhost -U govtech -d govtech_intel -tAc 'select 1' >/dev/null 2>&1; then DB=ok
  else start_pg; sleep 2
    if psql -h localhost -U govtech -d govtech_intel -tAc 'select 1' >/dev/null 2>&1; then DB="ok(restarted)"
    elif su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1; then DB="DOWN(db-missing:needs-rehydrate)"
    else DB="DOWN(cluster:needs-rehydrate)"; fi
  fi

  # ── emulated-Claude (only when EMULATE=1) ──
  if [ "$EMULATE" = "1" ]; then
    if curl -s -o /dev/null --max-time 3 "http://127.0.0.1:${EMU_PORT}/health" 2>/dev/null; then EMU=ok
    elif [ -f "$HARNESS/emulated-claude.mjs" ]; then start_emu; EMU="DOWN->restarting"
    else EMU="DOWN(no-harness)"; fi
  else EMU=off; fi

  # ── frontend server ──
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000/login 2>/dev/null)
  if [ "$CODE" = "200" ]; then SRV=ok
  elif port_busy 3000; then SRV="booting(${CODE})"
  elif [ -f "$STANDALONE/server.js" ]; then start_server; SRV="DOWN(${CODE})->restarting"
  else SRV="DOWN(no-build:needs-rehydrate)"; fi

  # ── pipeline worker (:8080 health server) — the workflow engine ──
  if port_busy 8080; then WRK=ok
  elif [ -f "$ROOT/pipeline/src/main.py" ]; then start_worker; WRK="DOWN->restarting"
  else WRK="DOWN(no-src)"; fi

  LINE="$(ts) cycle=$cycle srv=$SRV wrk=$WRK emu=$EMU db=$DB pad=$PAD"
  echo "$LINE" >> "$LOG"; echo "$LINE" > "$STATUS"
  if [ "$((cycle % 60))" -eq 0 ]; then tail -n 3000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" 2>/dev/null; fi
  sleep "$INTERVAL"
done
