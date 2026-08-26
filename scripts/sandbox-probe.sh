#!/usr/bin/env bash
# Semantic health probes for the sandbox — the shared definition of "healthy".
#
# Two ways in, both supported (see the dispatch at the foot of this file):
#   . scripts/sandbox-probe.sh                     source it, then call the functions
#   bash scripts/sandbox-probe.sh [probe_name]     run one (default probe_all) and exit its code
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY SEMANTIC PROBES, AND NOT PINGS
#
# A liveness check answers "is something listening". Every outage that actually
# cost time on this box answered YES to that while the thing was functionally
# dead. Three, all observed:
#
#   • The frontend returned 200 for half an hour while serving a build from
#     BEFORE the change under test. Next holds its modules in memory; a rebuild
#     replaces .next underneath a process that never notices.
#
#   • The worker was alive and draining platform workflows perfectly while
#     EVERY tenant-scoped workflow died on `new row violates row-level security
#     policy for table "process_instances"`. It had been started without
#     DATABASE_URL=$DATABASE_URL_OWNER, so RLS applied to it. `pgrep` said
#     healthy for 18 failed events.
#
#   • Postgres accepted connections against a data directory the container had
#     restored to an older snapshot — 21 migrations behind the tree, with tables
#     the code depends on simply absent.
#
# So each probe below performs the smallest REAL transaction that would fail if
# the service were useless, not merely absent. That is the entire design rule.
#
# ─────────────────────────────────────────────────────────────────────────────
# CONTRACT
#
# Every probe_*:
#   • returns 0 when healthy, non-zero otherwise
#   • echoes a one-line human reason ONLY on failure (silence == healthy, so a
#     caller can build a quiet loop without filtering)
#   • never blocks: every network/DB call carries an explicit timeout
#   • never mutates anything — probing is safe to run at any frequency, and the
#     repair path is somebody else's job (scripts/sandbox-up.sh)
#
# Requires the environment from scripts/sandbox-env.sh.

# Deliberately NOT `set -e`: a probe returning non-zero is normal control flow.
: "${DATABASE_URL_OWNER:?source scripts/sandbox-env.sh first}"

_PROBE_ROOT="${_PROBE_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# ── Postgres ─────────────────────────────────────────────────────────────────
# Reachability is the easy half. The half that matters is whether the schema is
# the one the code on disk expects: the container restores the data directory
# from a snapshot, so a perfectly healthy Postgres can be serving a database
# that predates half the migrations. A drifted DB fails in a hundred confusing
# ways downstream ("column does not exist" from a route nobody changed), so it
# is worth one extra query to name the real cause here.
probe_postgres() {
  local db_head disk_head
  pg_isready -q -t 5 2>/dev/null || { echo "postgres: not accepting connections"; return 1; }
  db_head="$(timeout 10 psql "$DATABASE_URL_OWNER" -tAc \
      "SELECT max(filename) FROM _migration_history" 2>/dev/null)" || {
    echo "postgres: reachable but the migration ledger could not be read"; return 1; }
  [ -n "$db_head" ] || { echo "postgres: no _migration_history — bare or wiped database"; return 1; }
  disk_head="$(ls "$_PROBE_ROOT"/db/migrations/*.sql 2>/dev/null | xargs -n1 basename | sort | tail -1)"
  [ -n "$disk_head" ] || return 0   # no migrations on disk to compare against
  if [ "$db_head" != "$disk_head" ]; then
    echo "postgres: SCHEMA DRIFT — db at ${db_head%%_*}, disk at ${disk_head%%_*}"
    return 1
  fi
  return 0
}

# ── Throwaway test database ──────────────────────────────────────────────────
# Not a running service, but its ABSENCE silently changes what the test suite
# means: ~257 DB-dependent pytest tests SKIP when TEST_DATABASE_URL is
# unreachable, so the suite reports green while the half that touches Postgres
# never ran. That is a worse outcome than a red suite, and it is invisible.
# Advisory only — the caller decides whether it is fatal.
probe_testdb() {
  [ -n "${TEST_DATABASE_URL:-}" ] || { echo "testdb: TEST_DATABASE_URL unset — DB-dependent tests will SKIP"; return 1; }
  timeout 10 psql "$TEST_DATABASE_URL" -tAc "SELECT 1" >/dev/null 2>&1 \
    || { echo "testdb: $TEST_DATABASE_URL unreachable — DB-dependent tests will SKIP"; return 1; }
  return 0
}

# ── Emulated Claude (:8787) ──────────────────────────────────────────────────
# A port check is useless here: the emulator 404s on `/` by design and only
# answers on POST /v1/messages. Every AI-gated flow routes through it via
# ANTHROPIC_BASE_URL, and when it is missing agent steps SAFE-SKIP — the
# journey completes, does less, and says nothing. So: make a real call and
# require a parseable body, which is what a caller would get.
probe_emulator() {
  local body
  body="$(timeout 8 curl -sf --max-time 6 -X POST -H 'content-type: application/json' \
      -d '{"model":"x","max_tokens":5,"messages":[{"role":"user","content":"ping"}]}' \
      http://127.0.0.1:8787/v1/messages 2>/dev/null)" \
    || { echo "emulator: POST /v1/messages failed"; return 1; }
  case "$body" in
    *'"content"'*) return 0 ;;
    *) echo "emulator: responded without a content block — ${body:0:80}"; return 1 ;;
  esac
}

# ── Pipeline worker ──────────────────────────────────────────────────────────
# THE PROBE THAT MATTERS MOST, because this is where "alive" and "working" came
# apart for 18 events and half an hour.
#
# Three things, in increasing order of what they catch:
#   1. the process exists at all;
#   2. it was launched on a role that can INSERT a tenant-scoped
#      process_instances row — read from /proc/<pid>/environ, which is exact,
#      rather than inferred from pg_stat_activity, which cannot distinguish the
#      worker's connections from anyone else's;
#   3. the queue is actually draining — a worker can be alive, correctly
#      configured, and wedged.
#
# On (2): process_instances has RLS with a tenant-equality INSERT policy and the
# worker sets no app.tenant_id (it is the engine, not an actor for one tenant).
# On a role RLS applies to, PLATFORM-scope instances insert fine and every
# TENANT-scoped one is rejected — ingest and curation keep working while the
# whole build half dies silently. See pipeline/src/db_role_preflight.py.
# DO NOT use `pgrep -f "src/main.py"` here. It matches ANY process whose command
# line merely CONTAINS that string — including the shell that invoked this probe,
# and including OTHER shells still running from earlier commands. Excluding `$$`
# is not enough: it only removes the current shell.
#
# That is not hypothetical. Building this probe, `pgrep -f` returned a leftover
# `/bin/bash -c …src/main.py…` shell ahead of the real worker; a shell's environ
# has no DATABASE_URL, so the role check below read an empty string, skipped
# itself, and the probe returned HEALTHY for a worker that was on the wrong role.
# The exact failure this function exists to catch, reproduced by the function
# itself. (Earlier the same trap killed a calling shell via `pkill -f`.)
#
# So identify by what the process IS, not what its arguments say: argv[0] must be
# a python interpreter AND some argument must be the script path. A shell can
# mention `src/main.py`; it cannot be argv[0]=python3.
worker_pid() {
  local p argv0 rest
  for p in /proc/[0-9]*; do
    [ -r "$p/cmdline" ] || continue
    # cmdline is NUL-separated; take argv[0] and then the whole thing as text.
    argv0="$(tr '\0' '\n' < "$p/cmdline" 2>/dev/null | head -1)"
    case "${argv0##*/}" in python|python3|python3.*) ;; *) continue ;; esac
    rest="$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null)"
    case "$rest" in *src/main.py*) basename "$p"; return 0 ;; esac
  done
  return 0
}

probe_worker() {
  local pid dsn stuck
  pid="$(worker_pid)"
  [ -n "$pid" ] || { echo "worker: not running"; return 1; }

  # An UNREADABLE environ is not a pass. "I could not verify the role" and "the
  # role is correct" are different answers, and only one of them is safe to
  # report as healthy — treating the unknown as fine is how the first version of
  # this probe returned healthy for a wrong-role worker.
  dsn="$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null | sed -n 's/^DATABASE_URL=//p' | head -1)"
  if [ -z "$dsn" ]; then
    echo "worker: pid $pid — DATABASE_URL not readable from its environ, role unverifiable"
    return 1
  fi
  if [ "$dsn" != "$DATABASE_URL_OWNER" ]; then
    echo "worker: running as the WRONG ROLE (${dsn#*//}) — tenant workflows will fail RLS silently"
    return 1
  fi

  # A wedged queue looks identical to an idle one from the outside, so give it a
  # generous grace period and only complain about instances that are genuinely
  # overdue. Platform-scope rows are invisible to a tenant-scoped connection, so
  # this must run on the owner DSN.
  stuck="$(timeout 10 psql "$DATABASE_URL_OWNER" -tAc \
      "SELECT count(*) FROM process_instances
        WHERE status = 'pending' AND created_at < now() - interval '10 minutes'" 2>/dev/null)"
  if [ -n "$stuck" ] && [ "$stuck" -gt 0 ] 2>/dev/null; then
    echo "worker: alive but $stuck workflow instance(s) pending >10min — queue not draining"
    return 1
  fi
  return 0
}

# ── Frontend (:3000) ─────────────────────────────────────────────────────────
# Identify the server by the process holding the LISTENING SOCKET, not by name,
# cwd or cmdline. All three of those were tried and all three failed here:
# the standalone server renames itself to `next-server (v15.x)`, Node rewrites
# its own argv after setting process.title, and `cleanDistDir` unlinks .next so
# the cwd resolves to "…(deleted)". The socket inode is the one identity neither
# the process nor a rebuild can invalidate. (Full history in sandbox-up.sh.)
frontend_pids() {
  local hex inode p
  hex=$(printf '%04X' 3000)
  inode=$(awk -v h=":$hex" 'NR>1 && $4=="0A" && index($2,h) {print $10}' /proc/net/tcp 2>/dev/null | head -1)
  [ -n "$inode" ] || return 0
  for p in /proc/[0-9]*; do
    ls -l "$p/fd" 2>/dev/null | grep -q "socket:\[$inode\]" && basename "$p"
  done
}

# Three failures, each invisible to the one before it:
#   200 on /            — the process is alive
#   the linked CSS 200s — it is actually DRESSED. `next build` does not stage
#                         public/ or .next/static into .next/standalone, so the
#                         app serves perfectly with 404 for every stylesheet;
#                         Tailwind's fixed/hidden/lg: all vanish and a mobile
#                         audit reports a 474px overflow as a layout regression.
#   started after BUILD_ID — it is serving the code ON DISK. A rebuild leaves the
#                         old process holding its modules; a test run against
#                         that is a confident wrong answer.
probe_frontend() {
  local css code build_at pid started
  timeout 8 curl -sf -o /dev/null --max-time 6 http://localhost:3000/login 2>/dev/null \
    || { echo "frontend: /login not serving"; return 1; }

  css="$(timeout 10 curl -s --max-time 8 http://localhost:3000/login 2>/dev/null \
        | grep -oE '/_next/static/css/[^"]+\.css' | head -1)"
  if [ -n "$css" ]; then
    code="$(timeout 8 curl -s -o /dev/null -w '%{http_code}' --max-time 6 "http://localhost:3000$css" 2>/dev/null)"
    [ "$code" = "200" ] || { echo "frontend: stylesheet $css → HTTP $code (serving UNSTYLED)"; return 1; }
  fi

  build_at=$(stat -c %Y "$_PROBE_ROOT/frontend/.next/BUILD_ID" 2>/dev/null || echo 0)
  if [ "$build_at" -gt 0 ]; then
    for pid in $(frontend_pids); do
      started=$(stat -c %Y "/proc/$pid" 2>/dev/null || echo 0)
      if [ "$started" -lt "$build_at" ]; then
        echo "frontend: process predates .next/BUILD_ID — serving a STALE build"
        return 1
      fi
    done
  fi
  return 0
}

# ── Build freshness (advisory) ───────────────────────────────────────────────
# Not a service. Distinct from the staleness check above: that one asks "is the
# RUNNING server older than the build on disk"; this asks "is the build on disk
# older than the SOURCE". Restarting fixes the first; only a rebuild fixes this,
# so a supervisor must report it rather than try to repair it — a `next build`
# takes minutes and must never be triggered behind someone's back.
probe_build_fresh() {
  local newest
  [ -f "$_PROBE_ROOT/frontend/.next/BUILD_ID" ] || { echo "build: no build on disk"; return 1; }
  newest="$(find "$_PROBE_ROOT/frontend/app" "$_PROBE_ROOT/frontend/lib" \
              "$_PROBE_ROOT/frontend/components" "$_PROBE_ROOT/frontend/middleware.ts" \
              "$_PROBE_ROOT/frontend/package.json" \
              -newer "$_PROBE_ROOT/frontend/.next/BUILD_ID" -type f \
              \( -name '*.ts' -o -name '*.tsx' -o -name '*.json' -o -name '*.css' \) 2>/dev/null | head -1)"
  [ -z "$newest" ] || { echo "build: STALE — $(basename "$newest") is newer than .next/BUILD_ID"; return 1; }
  return 0
}

# ── Roll-up ──────────────────────────────────────────────────────────────────
# Echoes one reason line per unhealthy service; returns the count of failures.
# Build freshness is reported but does NOT count as a failure: it cannot be
# repaired automatically, and a supervisor that treats it as an outage would
# restart a healthy stack in a loop for ever.
# ── e2e fixture accounts ─────────────────────────────────────────────────────
# A SERVING box is not a DRIVABLE box.
#
# The container has been reset eight times in this run. Postgres survives with its data directory,
# but that directory rolls back to the image snapshot — which predates the fixture accounts. So the
# stack comes up perfectly healthy and every driver still fails, because `lighthouse` does not
# exist, `admin@immobileyes.test` has no known password, and the specs that need them exit at their
# guards. Measured cost: the FIRST full suite of this session was 13 passed / 59 failed / 97 never
# run, and the entire difference was this seed not having been applied.
#
# It is cheap to check and cheap to fix, so the supervisor should do both rather than leaving a
# person to remember. Both seeders are idempotent and refuse a non-local DSN.
probe_fixtures() {
  local missing=""
  timeout 10 psql "$DATABASE_URL_OWNER" -tAc \
    "SELECT 1 FROM tenants WHERE slug='lighthouse'" 2>/dev/null | grep -q 1 \
    || missing="${missing} lighthouse-tenant"
  timeout 10 psql "$DATABASE_URL_OWNER" -tAc \
    "SELECT 1 FROM users WHERE email='eric@lighthouse.com' AND is_active" 2>/dev/null | grep -q 1 \
    || missing="${missing} e2e-logins"
  # ── Owned drive scenarios ────────────────────────────────────────────────
  # The tenant + logins above are restored by seed_dev_accounts.mjs; these are NOT, and their
  # absence cost two e2e runs before it was noticed. Each drive spec that mutates heavily claims a
  # scenario of its own via resolveShreddedSolicitation(env, owner), matched by an opportunity title
  # carrying "[owned:<name>]". A container restart takes the ingested BAAs with it, the resolver
  # then correctly refuses, and 6-7 specs report red for a reason that is not a code defect.
  #
  # The owner list is DERIVED from the call sites, not written down here, because a hand-kept copy
  # is exactly what let "flex" go missing: an earlier grep for the literal marker found four owners
  # and missed the fifth, which is passed as an argument.
  local owners want have
  owners="$(grep -rhoE "resolveShreddedSolicitation\([^)]*'[a-z0-9]+'\)" \
              "$_PROBE_ROOT/frontend/e2e"/*.ts 2>/dev/null \
            | grep -oE "'[a-z0-9]+'\)$" | tr -d "')" | sort -u)"
  for want in $owners; do
    have=$(timeout 10 psql "$DATABASE_URL_OWNER" -tAc \
      "SELECT count(*) FROM curated_solicitations cs
         JOIN opportunities o ON o.id = cs.opportunity_id
        WHERE cs.full_text IS NOT NULL
          AND length(cs.full_text) > 100000
          AND o.title LIKE '%[owned:${want}]%'" 2>/dev/null)
    [ "${have:-0}" -ge 1 ] || missing="${missing} scenario:${want}"
  done
  # The shared pool — what a spec resolves when it does NOT claim an owner.
  have=$(timeout 10 psql "$DATABASE_URL_OWNER" -tAc \
    "SELECT count(*) FROM curated_solicitations cs
       LEFT JOIN opportunities o ON o.id = cs.opportunity_id
      WHERE cs.full_text IS NOT NULL
        AND length(cs.full_text) > 100000
        AND coalesce(o.title,'') NOT LIKE '%[owned:%'" 2>/dev/null)
  [ "${have:-0}" -ge 1 ] || missing="${missing} scenario:shared-pool"

  [ -z "$missing" ] && return 0
  echo "fixtures: missing —${missing}"
  case "$missing" in
    *lighthouse-tenant*|*e2e-logins*) echo "  → node scripts/seed_dev_accounts.mjs" ;;
  esac
  case "$missing" in
    *scenario:*) echo "  → bash scripts/seed-drive-scenarios.sh   (rebuilds every missing one)" ;;
  esac
  return 1
}

probe_all() {
  local fails=0
  probe_postgres || fails=$((fails + 1))
  probe_emulator || fails=$((fails + 1))
  probe_worker   || fails=$((fails + 1))
  probe_frontend || fails=$((fails + 1))
  probe_fixtures || fails=$((fails + 1))
  probe_testdb   || true          # advisory
  probe_build_fresh || true       # advisory — needs a human-triggered rebuild
  return "$fails"
}

# ── CLI dispatch ─────────────────────────────────────────────────────────────
# WHY THIS EXISTS. This file is designed to be SOURCED (sandbox-watch.sh sources it and calls the
# functions), and it had nothing at the bottom — so `bash scripts/sandbox-probe.sh probe_all`
# defined the functions, reached EOF, and exited 0 without running a single check.
#
# That is the worst possible failure for a health tool: it answers "healthy" to every question,
# including ones about a box that is on fire. It was used that way repeatedly in this session and
# its `probe=0` was quoted as evidence of a working stack; it was evidence of nothing.
#
# Sourced use is unchanged — $0 differs from BASH_SOURCE when sourced, so this block is skipped.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  fn="${1:-probe_all}"
  case "$fn" in
    probe_*) ;;
    -h|--help|help)
      echo "usage: bash scripts/sandbox-probe.sh [probe_all|probe_postgres|probe_emulator|probe_worker|probe_frontend|probe_fixtures|probe_testdb|probe_build_fresh]"
      exit 0 ;;
    *) echo "unknown probe: $fn (try --help)" >&2; exit 2 ;;
  esac
  if ! declare -F "$fn" >/dev/null; then echo "unknown probe: $fn" >&2; exit 2; fi
  "$fn"
  exit $?
fi
