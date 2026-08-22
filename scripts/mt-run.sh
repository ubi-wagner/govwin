#!/usr/bin/env bash
# Run a sequence of midterm drives unattended: restage the current build, restart the standalone
# server, then run each named spec and record its REAL exit code.
#
# Why the exit code is recorded per-spec: `npx playwright test … | grep …` returns grep's status,
# not Playwright's, so a piped run reports success while the suite is failing (bug log B57). Each
# spec here writes EXIT=<n> to its own log and the summary reads those, never a pipeline status.
#
#   scripts/mt-run.sh mt1-ingest-multi mt2-onboard
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
S=/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad
mkdir -p "$S"

say() { printf '  %s\n' "$*"; }

# ── restage the built assets and restart the server ────────────────────────────
cd "$ROOT/frontend"
cp -r .next/static .next/standalone/.next/ 2>/dev/null
cp -r public .next/standalone/ 2>/dev/null
SELF=$$
for p in $(ls /proc 2>/dev/null | grep -E '^[0-9]+$'); do
  [ "$p" = "$SELF" ] && continue
  c=$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)
  case "$c" in "next-server"*) kill "$p" 2>/dev/null; say "stopped web $p";; esac
done
sleep 4
( cd .next/standalone && set -a && . "$S/server.env" 2>/dev/null; set +a
  nohup node server.js > "$S/server.log" 2>&1 & )
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login 2>/dev/null)
  [ "$code" = "200" ] && break
  sleep 2
done
say "server      $(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login)"

# ── run each spec, recording its own exit status ───────────────────────────────
. "$ROOT/scripts/sandbox-env.sh" >/dev/null 2>&1
rc_all=0
for spec in "$@"; do
  log="$S/$spec.log"
  say "running     $spec"
  npx playwright test --project=drive "$spec" --workers=1 --reporter=line > "$log" 2>&1
  rc=$?
  echo "EXIT=$rc" >> "$log"
  [ "$rc" -ne 0 ] && rc_all=1
  say "  $spec → exit $rc  ($log)"
done

say "── summary ──"
for spec in "$@"; do
  printf '  %-24s %s\n' "$spec" "$(grep -E '^EXIT=' "$S/$spec.log" | tail -1)"
done
exit $rc_all
