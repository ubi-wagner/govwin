#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# health-manager — keeps the demo box's SERVICES alive between turns.
# Every INTERVAL seconds it pings three things and auto-repairs what it owns:
#   • the pad (a scratch dir)  — writes a heartbeat, checks it's writable
#   • Postgres (govtech_intel) — starts the PG16 cluster if it's down
#   • the frontend server :3000 — restarts node from the standalone build if down
# Writes an append log (health.log) + a one-line status (health-status.txt) under $SCR.
#
# SCOPE: this maintains services *inside a live VM*. It CANNOT prevent (or survive)
# a Claude-Code-on-the-web VM reclaim — that wipes the whole container, this included.
# When state it can't rebuild is gone it says so distinctly:
#   db=DOWN(db-missing:needs-rebuild) / srv=DOWN(no-build:needs-rebuild)
# → then run  frontend/scripts/rehydrate-sandbox.sh  to restore DB + build.
#
# Launch (must be a *background* task so it persists — a foreground child gets reaped):
#   Bash(run_in_background=true): SCR=<pad> INTERVAL=60 bash frontend/scripts/health-manager.sh
# ─────────────────────────────────────────────────────────────────────────────
set -u
SCR="${SCR:-/tmp/govwin-health}"          # default is reclaim-safe; pass SCR=<scratchpad> to ping the real pad
mkdir -p "$SCR" 2>/dev/null
LOG="$SCR/health.log"; STATUS="$SCR/health-status.txt"; HEART="$SCR/.heartbeat"
STANDALONE="/home/user/govwin/frontend/.next/standalone"
DBURL='postgresql://govtech:changeme@localhost:5432/govtech_intel'
INTERVAL="${INTERVAL:-60}"
export PGPASSWORD=changeme
ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }

start_server() {
  ( cd "$STANDALONE" && \
    DATABASE_URL="$DBURL" AUTH_SECRET='dev-screenshot-secret-000' AUTH_TRUST_HOST=true \
    NEXTAUTH_URL='http://localhost:3000' AUTH_URL='http://localhost:3000' \
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers PORT=3000 HOSTNAME=0.0.0.0 \
    node server.js >> "$SCR/server.log" 2>&1 & )
}
start_pg() {
  pg_ctlcluster 16 main start >/dev/null 2>&1 \
    || su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main -l /var/log/postgresql/postgresql-16-main.log start" >/dev/null 2>&1
}

cycle=0
echo "$(ts) health-manager started (pid $$, interval ${INTERVAL}s, pad=$SCR)" >> "$LOG"
while true; do
  cycle=$((cycle + 1))

  if echo "alive $(ts) cycle=$cycle" > "$HEART" 2>/dev/null; then PAD=ok; else PAD=FAIL; fi

  if psql -h localhost -U govtech -d govtech_intel -tAc 'select 1' >/dev/null 2>&1; then
    DB=ok
  else
    start_pg; sleep 2
    if psql -h localhost -U govtech -d govtech_intel -tAc 'select 1' >/dev/null 2>&1; then DB="ok(restarted)"
    elif su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1; then DB="DOWN(db-missing:needs-rebuild)"
    else DB="DOWN(cluster)"; fi
  fi

  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:3000/login 2>/dev/null)
  if [ "$CODE" = "200" ]; then SRV=ok
  elif ss -ltn 2>/dev/null | grep -q ':3000'; then SRV="booting(${CODE})"
  elif [ -f "$STANDALONE/server.js" ]; then start_server; SRV="DOWN(${CODE})->restarting"
  else SRV="DOWN(no-build:needs-rebuild)"; fi

  LINE="$(ts) cycle=$cycle srv=$SRV db=$DB pad=$PAD"
  echo "$LINE" >> "$LOG"; echo "$LINE" > "$STATUS"
  if [ "$((cycle % 60))" -eq 0 ]; then tail -n 3000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" 2>/dev/null; fi

  sleep "$INTERVAL"
done
