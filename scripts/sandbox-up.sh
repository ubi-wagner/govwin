#!/usr/bin/env bash
# Bring the whole sandbox up, idempotently, and don't return until it is actually serving.
#
# WHY THIS EXISTS. The container has stopped every process three times during this run, and each
# recovery cost several round-trips of "start postgres, start the emulator, start the worker, start
# the frontend, check each one". None of that is interesting work. This is the one command.
#
# Idempotent by design: anything already up is left alone, so it is safe to run before any journey
# without thinking about what state the box is in.
#
#   source scripts/sandbox-env.sh && scripts/sandbox-up.sh
#
# Exits non-zero if anything is still not serving at the end, so a caller can trust a zero.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
: "${GOVWIN_RUN_DIR:?source scripts/sandbox-env.sh first}"
mkdir -p "$GOVWIN_RUN_DIR"

say() { printf '  %s\n' "$*"; }

# ── Postgres ────────────────────────────────────────────────────────────────
if pg_isready -q 2>/dev/null; then
  say "postgres    already up"
else
  pg_ctlcluster 16 main start >/dev/null 2>&1 || service postgresql start >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do pg_isready -q 2>/dev/null && break; sleep 1; done
  pg_isready -q 2>/dev/null && say "postgres    started" || say "postgres    FAILED"
fi

# ── Schema drift ────────────────────────────────────────────────────────────
# The container restores the Postgres data directory to an old snapshot on every restart, the same
# way it restores the repo and /tmp. Observed three times: the DB came back 21 migrations behind
# the tree with tables the code depends on simply absent, and a security migration plus an operator
# password reset silently undone. Nothing survives except what is pushed to the git remote.
#
# So the box heals itself here rather than in my head: compare the applied head to the newest file
# on disk and migrate forward if it is behind. A missing ledger means a bare or wiped database, and
# only then is a full reset allowed — never as a convenience.
if pg_isready -q 2>/dev/null; then
  disk_head="$(ls db/migrations/*.sql 2>/dev/null | xargs -n1 basename | sort | tail -1)"
  db_head="$(psql "$DATABASE_URL_OWNER" -tAc "SELECT max(filename) FROM _migration_history" 2>/dev/null || echo '')"
  if [ -z "$db_head" ]; then
    say "schema      no migration ledger — building from 001"
    ALLOW_SCHEMA_RESET=true DATABASE_URL="$DATABASE_URL_OWNER" node db/migrations/migrate.mjs >"$GOVWIN_RUN_DIR/migrate.log" 2>&1
    say "schema      $(tail -1 "$GOVWIN_RUN_DIR/migrate.log")"
  elif [ "$db_head" != "$disk_head" ]; then
    say "schema      DRIFT: db at ${db_head%%_*}, disk at ${disk_head%%_*} — migrating forward"
    DATABASE_URL="$DATABASE_URL_OWNER" node db/migrations/migrate.mjs >"$GOVWIN_RUN_DIR/migrate.log" 2>&1
    say "schema      $(tail -1 "$GOVWIN_RUN_DIR/migrate.log")"
  else
    say "schema      at head (${disk_head%%_*})"
  fi

  # Migrations 124 and 198 deliberately leave every seeded admin on a random hash nobody holds, so
  # a restored database has no way into /admin. This is the out-of-band reset a real operator does,
  # and it refuses to run against anything but a local DSN.
  if ! psql "$DATABASE_URL_OWNER" -tAc \
      "SELECT 1 FROM users WHERE email='eric@rfppipeline.com' AND temp_password=false AND password_hash LIKE '\$2a\$12\$%'" \
      2>/dev/null | grep -q 1; then
    ( cd frontend && node ../scripts/sandbox-reset-passwords.mjs ) >"$GOVWIN_RUN_DIR/pwreset.log" 2>&1 \
      && say "accounts    sandbox passwords set" || say "accounts    reset FAILED (see pwreset.log)"
  else
    say "accounts    already driveable"
  fi
fi

# ── Emulated Claude (:8787) ─────────────────────────────────────────────────
# Every AI-gated flow routes here via ANTHROPIC_BASE_URL, mirroring the production wiring with no
# live key (docs/AI_FLOWS_PROOF.md). Without it, agent steps safe-skip and journeys quietly do less.
if curl -sf -o /dev/null --max-time 3 -X POST -H 'content-type: application/json' \
     -d '{"model":"x","max_tokens":5,"messages":[{"role":"user","content":"hi"}]}' \
     http://127.0.0.1:8787/v1/messages 2>/dev/null; then
  say "emulator    already up"
else
  nohup node "$ROOT/frontend/scripts/test-harness/emulated-claude.mjs" \
    > "$GOVWIN_RUN_DIR/emulator.log" 2>&1 &
  for _ in $(seq 1 20); do
    curl -sf -o /dev/null --max-time 2 -X POST -H 'content-type: application/json' \
      -d '{"model":"x","max_tokens":5,"messages":[{"role":"user","content":"hi"}]}' \
      http://127.0.0.1:8787/v1/messages 2>/dev/null && break
    sleep 1
  done
  say "emulator    started"
fi

# ── Pipeline worker ─────────────────────────────────────────────────────────
# Runs as the OWNER role: the workflow engine's instances are platform-scope (tenant_id IS NULL) and
# the tenant policies are tenant-equality, so under govtech_app it cannot claim its own instance.
# rfp_agent is still deploy-gated (docs/RLS_CUTOVER.md:6).
if pgrep -f "python3 src/main.py" >/dev/null 2>&1; then
  say "worker      already up"
else
  ( cd "$ROOT/pipeline" && DATABASE_URL="$DATABASE_URL_OWNER" PYTHONPATH=src \
      nohup python3 src/main.py > "$GOVWIN_RUN_DIR/worker.log" 2>&1 & )
  sleep 3
  pgrep -f "python3 src/main.py" >/dev/null 2>&1 && say "worker      started" || say "worker      FAILED"
fi

# ── Stale build ─────────────────────────────────────────────────────────────
# The build is a SNAPSHOT of the source, and nothing here rebuilds it — so a box that is "already
# up" can be serving code from days ago while every test reads the current tree and concludes the
# product is broken. That is exactly what happened: the running server was built Aug 15 01:20, the
# bucket criteria-merge + synchronous re-rank landed at 03:02 the same day, and hitl-bucket-rls
# spent a whole run reporting a clobbered PATCH that the source had already fixed. A test result
# against a stale binary is worse than no result — it is a confident wrong answer.
#
# So say it out loud. Compare the build stamp to the newest file the build actually depends on;
# louder than a comment in a runbook, and it costs one `find`.
if [ -f frontend/.next/BUILD_ID ]; then
  newest="$(find frontend/app frontend/lib frontend/components frontend/package.json \
              -newer frontend/.next/BUILD_ID -type f \
              \( -name '*.ts' -o -name '*.tsx' -o -name '*.json' -o -name '*.css' \) 2>/dev/null | head -1)"
  if [ -n "$newest" ]; then
    say "build       STALE — $(basename "$newest") is newer than .next/BUILD_ID"
    say "            rebuild before testing:  cd frontend && npx next build"
  else
    say "build       current"
  fi
fi

# ── Frontend (:3000) ────────────────────────────────────────────────────────
# `next start` is broken here (output:'standalone') — the standalone server is the only way in, and
# it needs public/ + .next/static staged beside it. See docs/CONTINUATION.md §2.
#
# "Responding" is not "running the build on disk". A rebuild replaces .next while the OLD process
# keeps its modules in memory, so the box answers 200 with code from whenever it was started — and
# that is exactly how a whole test run got measured against a five-day-old binary. Next stamps the
# build id into every page it renders, so ask the SERVER which build it is, not the filesystem.
#
# Two traps live here, both hit for real:
#   • the standalone server renames itself to `next-server (v15.x)`, so `pkill -f standalone/server.js`
#     matches NOTHING and a "restart" silently no-ops;
#   • `pkill -f next-server` from an interactive shell matches the shell's OWN command line and
#     kills the caller. Match on the script path in /proc instead — the title is cosmetic, argv is not.
# Matching on /proc/*/cmdline does NOT work either, and this cost a full debugging round: Node
# rewrites its own argv memory when it sets process.title, so moments after boot the cmdline reads
# `next-server (v15.5.14)` with no trace of the script path. A scan run right after `nohup` finds the
# process; the same scan a minute later finds nothing, which reads exactly like "the server died".
# What does NOT get rewritten is the working directory: server.js does process.chdir(__dirname), so
# the standalone server is precisely the process whose cwd is .next/standalone.
# …and matching on the working directory does not survive either, which cost a third round. Next is
# configured with cleanDistDir, so `next build` UNLINKS .next and recreates it: the running server's
# cwd becomes ".next/standalone (deleted)", the name no longer resolves to the live path, the matcher
# stops matching, and the old process keeps serving from unlinked files across every subsequent
# rebuild. Observed serving a 30-minute-old build through two of them.
#
# So identify it by the only thing that is definitionally true of "the server on :3000" and that
# neither the process nor the build can invalidate: the process holding the listening socket. Read
# the inode from /proc/net/tcp and find the pid whose fds include it.
frontend_pids() {
  local hex inode
  hex=$(printf '%04X' 3000)
  inode=$(awk -v h=":$hex" 'NR>1 && $4=="0A" && index($2,h) {print $10}' /proc/net/tcp 2>/dev/null | head -1)
  [ -n "$inode" ] || return 0
  for p in /proc/[0-9]*; do
    ls -l "$p/fd" 2>/dev/null | grep -q "socket:\[$inode\]" && basename "$p"
  done
}
# The app router does not print the build id into the HTML, so ask the clock instead: a process
# that started BEFORE .next/BUILD_ID was stamped loaded the previous build's modules and is still
# holding them. That comparison is exact for the failure that actually happens (rebuild, forget to
# restart / think you restarted) and needs nothing from the page.
if curl -sf -o /dev/null --max-time 3 http://localhost:3000/ 2>/dev/null; then
  build_at=$(stat -c %Y frontend/.next/BUILD_ID 2>/dev/null || echo 0)
  restart=0
  for pid in $(frontend_pids); do
    started=$(stat -c %Y "/proc/$pid" 2>/dev/null || echo 0)
    [ "$started" -lt "$build_at" ] && restart=1
  done
  if [ "$restart" = 1 ]; then
    say "frontend    process predates the build — restarting so it serves what is on disk"
    for pid in $(frontend_pids); do kill "$pid" 2>/dev/null; done
    sleep 2
  else
    say "frontend    already up (running the current build)"
  fi
fi
# `next build` does NOT put public/ or .next/static inside .next/standalone — you stage them, every
# build, or the server runs perfectly while serving 404 for every stylesheet. That is not a subtle
# degradation: with no CSS, Tailwind's `fixed`, `hidden`, `lg:` and `-translate-x-full` all vanish,
# the nav drawer renders inline at full width, and the mobile audit reports a 474px horizontal
# overflow as if the layout had regressed. A whole suite run was spent on an unstyled app because
# one `cp` in a restart line was killed and nothing checked. Stage it unconditionally (cheap), and
# then PROVE the stylesheet actually serves before declaring the stack up.
stage_assets() {
  [ -d "$ROOT/frontend/.next/standalone" ] || return 1
  mkdir -p "$ROOT/frontend/.next/standalone/.next" || return 1
  cp -r "$ROOT/frontend/public" "$ROOT/frontend/.next/standalone/" 2>/dev/null
  cp -r "$ROOT/frontend/.next/static" "$ROOT/frontend/.next/standalone/.next/" 2>/dev/null
  [ -d "$ROOT/frontend/.next/standalone/.next/static/css" ]
}
if curl -sf -o /dev/null --max-time 3 http://localhost:3000/ 2>/dev/null; then
  :
else
  if [ ! -d "$ROOT/frontend/.next/standalone" ]; then
    say "frontend    no build — run: cd frontend && npx next build"
  else
    stage_assets || say "frontend    WARNING: static assets did not stage"
    ( cd "$ROOT/frontend" && nohup node .next/standalone/server.js \
        > "$GOVWIN_RUN_DIR/frontend.log" 2>&1 & )
    for _ in $(seq 1 30); do
      curl -sf -o /dev/null --max-time 2 http://localhost:3000/ 2>/dev/null && break
      sleep 1
    done
    say "frontend    started"
  fi
fi

# ── Verdict ─────────────────────────────────────────────────────────────────
fail=0
pg_isready -q 2>/dev/null || { echo "  ✗ postgres not serving"; fail=1; }
curl -sf -o /dev/null --max-time 3 -X POST -H 'content-type: application/json' \
  -d '{"model":"x","max_tokens":5,"messages":[{"role":"user","content":"hi"}]}' \
  http://127.0.0.1:8787/v1/messages 2>/dev/null || { echo "  ✗ emulator not serving"; fail=1; }
pgrep -f "python3 src/main.py" >/dev/null 2>&1 || { echo "  ✗ worker not running"; fail=1; }
if curl -sf -o /dev/null --max-time 3 http://localhost:3000/ 2>/dev/null; then
  # A 200 on / says the server is alive, not that the app is dressed. Follow the stylesheet the
  # login page actually links and check it comes back — a 404 here is the unstyled-app failure, and
  # it is invisible to every other probe in this script.
  css="$(curl -s --max-time 5 http://localhost:3000/login | grep -oE '/_next/static/css/[^"]+\.css' | head -1)"
  if [ -n "$css" ]; then
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://localhost:3000$css")"
    if [ "$code" != "200" ]; then
      echo "  ✗ stylesheet $css → HTTP $code (app is serving UNSTYLED — stage .next/static + public)"
      fail=1
    fi
  fi
else
  echo "  ✗ frontend not serving"; fail=1
fi
[ "$fail" -eq 0 ] && echo "  ✓ stack up" || echo "  ✗ stack incomplete"
exit "$fail"
