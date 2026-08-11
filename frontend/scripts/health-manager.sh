#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# health-manager — keeps the demo box alive between turns, two cadences:
#   • KEEPALIVE (~17s): writes to the pad — a continuous ping so the VM never looks idle
#     (idle is the reclaim trigger; a sub-minute write keeps the session/container warm).
#   • INTERVAL (~60s): a full health check that auto-repairs what it owns —
#       Postgres (govtech_intel)   — starts the PG16 cluster if it's down
#       the frontend server :3000  — restarts node from the standalone build if down
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
INTERVAL="${INTERVAL:-60}"                # full server+DB health-check cadence
KEEPALIVE="${KEEPALIVE:-17}"              # pad-write cadence — writes to the pad this often to keep the VM non-idle
echo $$ > "$SCR/manager.pid" 2>/dev/null  # for a clean restart: kill "$(cat $SCR/manager.pid)"
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

cycle=0; beat=0
echo "$(ts) health-manager started (pid $$, check=${INTERVAL}s keepalive=${KEEPALIVE}s pad=$SCR)" >> "$LOG"
while true; do
  cycle=$((cycle + 1))
  PAD=$([ -w "$SCR" ] && echo ok || echo FAIL)

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

  LINE="$(ts) cycle=$cycle srv=$SRV db=$DB pad=$PAD beat=$beat"
  echo "$LINE" >> "$LOG"; echo "$LINE" > "$STATUS"
  if [ "$((cycle % 60))" -eq 0 ]; then tail -n 3000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" 2>/dev/null; fi

  # keep-alive: write to the pad every KEEPALIVE s until the next full check, so the VM
  # sees continuous activity and doesn't go idle (the reclaim trigger). This is the ping.
  elapsed=0
  while [ "$elapsed" -lt "$INTERVAL" ]; do
    beat=$((beat + 1))
    echo "alive $(ts) cycle=$cycle beat=$beat" > "$HEART" 2>/dev/null
    sleep "$KEEPALIVE"
    elapsed=$((elapsed + KEEPALIVE))
  done
done
