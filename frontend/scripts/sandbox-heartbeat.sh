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
DBURL='postgresql://govtech:changeme@localhost:5432/govtech_intel'
INTERVAL="${INTERVAL:-20}"
EMULATE="${EMULATE:-0}"
EMU_PORT="${EMU_PORT:-8787}"
export PGPASSWORD=changeme
mkdir -p "$SCR"
LOG="$SCR/health.log"; STATUS="$SCR/health-status.txt"; HEART="$SCR/.heartbeat"; EMU_LOG="$SCR/emulated-claude.log.jsonl"

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }

emu_env() { [ "$EMULATE" = "1" ] && echo "ANTHROPIC_BASE_URL=http://127.0.0.1:${EMU_PORT} ANTHROPIC_API_KEY=emulated-claude"; }
start_server() {
  ( cd "$STANDALONE" && env \
      DATABASE_URL="$DBURL" AUTH_SECRET='dev-screenshot-secret-000' AUTH_TRUST_HOST=true \
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
  elif ss -ltn 2>/dev/null | grep -q ':3000'; then SRV="booting(${CODE})"
  elif [ -f "$STANDALONE/server.js" ]; then start_server; SRV="DOWN(${CODE})->restarting"
  else SRV="DOWN(no-build:needs-rehydrate)"; fi

  LINE="$(ts) cycle=$cycle srv=$SRV emu=$EMU db=$DB pad=$PAD"
  echo "$LINE" >> "$LOG"; echo "$LINE" > "$STATUS"
  if [ "$((cycle % 60))" -eq 0 ]; then tail -n 3000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" 2>/dev/null; fi
  sleep "$INTERVAL"
done
