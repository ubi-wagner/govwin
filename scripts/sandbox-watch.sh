#!/usr/bin/env bash
# Keep the sandbox alive: probe every service semantically, repair what broke, stay quiet otherwise.
#
#   source scripts/sandbox-env.sh
#   nohup scripts/sandbox-watch.sh > "$GOVWIN_RUN_DIR/watch.log" 2>&1 &
#
#   INTERVAL=60     seconds between cycles (default 60)
#   ONCE=1          run a single cycle and exit with the failure count — for CI or a manual check
#   AUTO_REBUILD=1  rebuild the frontend in the background when the build on disk is older than the
#                   source, then restart the server against it. OFF by default — see below.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY AUTO_REBUILD IS OPT-IN, AND WHY THIS BOX NEEDS IT ON
#
# The first version of this file treated a stale build as strictly advisory, on the reasoning that a
# `next build` takes minutes and must never be triggered behind someone's back. That is the right
# default for a machine a person is working on.
#
# It is the WRONG default here, and today proved it. This container restores itself from a fixed
# snapshot roughly every half hour — six times in one session — and the snapshot carries a SIX-DAY-OLD
# .next. So the supervisor would faithfully heal the stack back to "healthy" while the server served
# code from before most of the work under test. That is not a degraded state, it is a confidently
# wrong one: a route was investigated as a product defect for several rounds before the six-day-old
# build turned out to be the whole explanation. Two rebuilds were then destroyed by resets before a
# server could be restarted against them.
#
# So: opt in, and this sandbox opts in. The safety properties that made it advisory are kept —
#   • never more than one build at a time (a pidfile, not a `pgrep`);
#   • the build runs DETACHED and the cycle returns immediately, so a 5-minute build never blocks
#     the health loop or delays the repair of anything else;
#   • the running server is replaced only AFTER a build completes successfully — a failed build
#     leaves the current server untouched, because a stale stack still beats no stack;
#   • the log says what it is doing, because a rebuild is the one repair with a visible cost.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS REPLACES, AND WHY
#
# scripts/heartbeat.sh was the previous attempt and had become a FOSSIL: it
# probes Postgres on :5433 with a data directory under /tmp/pgs_gov, while this
# box runs :5432 via pg_ctlcluster at /var/lib/postgresql/16/main — and
# sandbox-env.sh's own header records that nothing the run depends on lives in
# /tmp any more, precisely because a container restart took it. It also has no
# idea the pipeline worker or the Claude emulator exist, which are two of the
# four services. Run today it would report a healthy stack against a topology
# that no longer exists. Deleted rather than patched: a monitor that can be
# confidently wrong is worse than none.
#
# ─────────────────────────────────────────────────────────────────────────────
# THREE DESIGN DECISIONS, EACH PAID FOR
#
# 1. PROBES ARE SEMANTIC, NOT LIVENESS.  Delegated wholesale to
#    scripts/sandbox-probe.sh so this loop and sandbox-up.sh's final verdict can
#    never disagree about what "healthy" means. The rationale for each probe
#    lives there; the short version is that every outage which actually cost
#    time on this box answered YES to a liveness check while being useless.
#
# 2. REPAIR DELEGATES TO sandbox-up.sh.  That script is idempotent, fast when
#    healthy, and already encodes every trap this environment has produced —
#    the socket-inode process identity, the staging of .next/static, the schema
#    drift migrate-forward, the out-of-band password reset. Duplicating any of
#    it here would create a second source of truth that drifts. So the
#    supervisor's own logic is deliberately thin: detect, invoke the bring-up,
#    re-probe, report.
#
#    ONE EXCEPTION, and it is the reason this file is not a three-line loop.
#    sandbox-up.sh decides the worker is fine if a `python3 src/main.py` process
#    exists. A worker running on the WRONG DATABASE ROLE satisfies that check
#    perfectly while every tenant-scoped workflow dies on RLS. So when the probe
#    reports a bad role, this kills the process FIRST — otherwise the bring-up
#    looks at it, says "worker already up", and the box stays broken through
#    every repair cycle for ever.
#
# 3. SILENCE IS THE HEALTHY STATE.  A cycle that finds nothing wrong prints
#    nothing. This is not cosmetic: the bug fixed in cdee5450 was a workflow
#    processor logging an expected-by-design event at INFO every 10 seconds, and
#    40-of-40 identical lines is what hid a burst of real RLS failures for half
#    an hour. A monitor that chatters trains you to stop reading it, which
#    defeats the only thing it is for. Heartbeats go to a single mtime-touched
#    file instead, so "is it still running" is answerable without log volume.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT THIS CANNOT DO
#
# It cannot survive a container reset. Twice today the box came back with the
# repo rolled to an older commit, /tmp emptied, scripts/sandbox-env.sh absent
# and the Postgres data directory restored from a snapshot. No in-container
# process survives that, at any interval. The defence against a reset is not
# monitoring — it is that every commit is pushed and every bring-up step is
# scripted in the repo, so recovery is one command instead of an archaeology
# session. This supervisor shortens the OTHER outages, which are the frequent
# ones: a stale pid file, an OOM-killed worker, a frontend left behind by a
# rebuild.

set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
: "${GOVWIN_RUN_DIR:?source scripts/sandbox-env.sh first}"
mkdir -p "$GOVWIN_RUN_DIR"

# shellcheck source=scripts/sandbox-probe.sh
. "$ROOT/scripts/sandbox-probe.sh"

INTERVAL="${INTERVAL:-60}"
ONCE="${ONCE:-}"
BEAT="$GOVWIN_RUN_DIR/watch.beat"      # mtime == last completed cycle
STATE="$GOVWIN_RUN_DIR/watch.state"    # last reported condition, for edge-triggering

#: Give up shouting after this many consecutive failed repairs of the same thing.
#: The supervisor keeps trying — it just stops filling the log with an identical
#: line, because at that point the message is "a human is needed", not "news".
_MAX_LOUD_REPAIRS=3

AUTO_REBUILD="${AUTO_REBUILD:-}"
BUILD_PID="$GOVWIN_RUN_DIR/rebuild.pid"
BUILD_LOG="$GOVWIN_RUN_DIR/rebuild.log"

log() { printf '%s  %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# ── Rebuild-on-stale ─────────────────────────────────────────────────────────
# Called once per cycle when AUTO_REBUILD is set. Three states, and it must be cheap in all of them
# because it runs every 60s:
#   a build is already running  → do nothing (checked by PID, not by `pgrep -f "next build"`, which
#                                 matches this script's own command line — the self-match trap that
#                                 has killed a calling shell twice on this box)
#   a build just finished       → stage assets, restart the server against it, report
#   the build is stale          → start one, detached, and return immediately
rebuild_if_stale() {
  local pid
  # (a) in flight?
  if [ -f "$BUILD_PID" ]; then
    pid="$(cat "$BUILD_PID" 2>/dev/null)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      return 0                      # still building — say nothing, it is expected
    fi
    rm -f "$BUILD_PID"
    # (b) it finished while we were away. Did it work? `Route (app)` is the route table Next prints
    # only on a successful build; grepping for the ABSENCE of errors would pass on a truncated log.
    if grep -q "Route (app)" "$BUILD_LOG" 2>/dev/null; then
      log "           rebuild finished — restarting the server against it"
      for p in $(frontend_pids); do kill "$p" 2>/dev/null; done
      sleep 2
      # sandbox-up.sh stages public/ + .next/static and starts the standalone server. Reusing it
      # keeps one implementation of that sequence, which has three separate traps in its history.
      timeout 300 bash "$ROOT/scripts/sandbox-up.sh" >"$GOVWIN_RUN_DIR/watch-repair.log" 2>&1
    else
      log "           rebuild FAILED — leaving the running server alone (see rebuild.log)"
      log "           $(grep -m1 -E 'Failed to compile|Type error|Error:' "$BUILD_LOG" 2>/dev/null | cut -c1-140)"
    fi
    return 0
  fi
  # (c) nothing in flight — start one only if the build is actually behind the source.
  probe_build_fresh >/dev/null 2>&1 && return 0
  log "           build is stale — rebuilding in the background (server keeps serving meanwhile)"
  ( cd "$ROOT/frontend" && setsid nohup npx next build > "$BUILD_LOG" 2>&1 &
    echo $! > "$BUILD_PID" ) 2>/dev/null
  return 0
}

running=1
# Exit cleanly so a `kill` does not leave a half-written state file behind, and
# so the operator gets a definite "stopped" rather than silence.
trap 'running=0' TERM INT
trap 'log "supervisor stopped"' EXIT

log "supervisor started (interval=${INTERVAL}s, probes: postgres · emulator · worker · frontend)"

consecutive=0
last_state=""

cycle() {
  local reasons rc repaired=0 after_reasons after_rc

  # ── Probe ──────────────────────────────────────────────────────────────────
  reasons="$(probe_all 2>&1)"; rc=$?

  if [ "$rc" -eq 0 ]; then
    # Healthy. Report only on the EDGE — the transition back from broken — so a
    # long healthy stretch produces exactly one line, not one per minute.
    if [ "$last_state" != "healthy" ]; then
      log "healthy — all services responding to real transactions"
      [ -n "$reasons" ] && printf '%s\n' "$reasons" | sed 's/^/           advisory: /'
      last_state="healthy"; : > "$STATE"; echo "healthy" > "$STATE"
    fi
    consecutive=0
    # A stale build is ORTHOGONAL to service health — every service can be up and correct while the
    # server serves last week's code. So this runs on the HEALTHY path, which is in fact where it
    # matters most: after a container reset the stack comes back "healthy" on the snapshot's build.
    [ -n "$AUTO_REBUILD" ] && rebuild_if_stale
    touch "$BEAT"
    return 0
  fi

  # ── Report what broke ──────────────────────────────────────────────────────
  # Always log the transition INTO unhealthy, and every repair attempt up to the
  # loud limit. Past that, keep repairing but stop repeating ourselves.
  if [ "$last_state" != "$reasons" ] || [ "$consecutive" -lt "$_MAX_LOUD_REPAIRS" ]; then
    log "UNHEALTHY ($rc service(s)):"
    printf '%s\n' "$reasons" | sed 's/^/           /'
  fi
  last_state="$reasons"

  # ── Targeted pre-repair: the wrong-role worker ─────────────────────────────
  # sandbox-up.sh would see this process and declare "worker already up", so the
  # bring-up cannot fix it on its own. Kill it here and let the bring-up start a
  # replacement with DATABASE_URL=$DATABASE_URL_OWNER.
  if printf '%s' "$reasons" | grep -q 'WRONG ROLE'; then
    local wpid
    wpid="$(worker_pid)"
    if [ -n "$wpid" ]; then
      log "           repairing: killing worker $wpid (wrong DB role) so the bring-up can replace it"
      kill "$wpid" 2>/dev/null
      # Give it a moment to release its DB connections before the restart.
      for _ in 1 2 3 4 5; do kill -0 "$wpid" 2>/dev/null || break; sleep 1; done
      kill -9 "$wpid" 2>/dev/null
      repaired=1
    fi
  fi

  # ── Repair: one idempotent bring-up ────────────────────────────────────────
  # Timed out rather than trusted: a bring-up that wedges (a hung migration, a
  # build that never finishes) must not take the supervisor down with it.
  if timeout 600 bash "$ROOT/scripts/sandbox-up.sh" >"$GOVWIN_RUN_DIR/watch-repair.log" 2>&1; then
    repaired=1
  else
    # Non-zero is normal here when something genuinely cannot be fixed
    # automatically (no build on disk, for instance). The re-probe below is the
    # real verdict, so this is not treated as fatal.
    repaired=1
  fi

  # ── Verdict: re-probe, because "the repair ran" is not "the repair worked" ──
  after_reasons="$(probe_all 2>&1)"; after_rc=$?
  if [ "$after_rc" -eq 0 ]; then
    log "           repaired — stack healthy again"
    consecutive=0; last_state="healthy"; echo "healthy" > "$STATE"
  else
    consecutive=$((consecutive + 1))
    if [ "$consecutive" -le "$_MAX_LOUD_REPAIRS" ]; then
      log "           STILL UNHEALTHY after repair (attempt $consecutive):"
      printf '%s\n' "$after_reasons" | sed 's/^/           /'
      [ "$consecutive" -eq "$_MAX_LOUD_REPAIRS" ] && \
        log "           (further identical failures will be repaired quietly — see watch-repair.log)"
    fi
    last_state="$after_reasons"
    printf '%s\n' "$after_reasons" > "$STATE"
  fi
  # Also on the repair path, and this is the case that actually happens: a container reset takes the
  # services AND restores the snapshot's build, so the very cycle that brings the stack back up is
  # the one that must notice the build is six days old. Wiring it only to the healthy path would
  # have left the rebuild waiting for the NEXT cycle at best, and never at all if anything stayed
  # unhealthy. (Caught by testing — the first version did exactly that.)
  [ -n "$AUTO_REBUILD" ] && rebuild_if_stale
  touch "$BEAT"
  return "$after_rc"
}

if [ -n "$ONCE" ]; then
  cycle
  exit $?
fi

while [ "$running" = 1 ]; do
  cycle
  # Sleep in short slices so a TERM is honoured promptly instead of after a full
  # interval — an operator killing this should not wait a minute for it to stop.
  for _ in $(seq 1 "$INTERVAL"); do
    [ "$running" = 1 ] || break
    sleep 1
  done
done
