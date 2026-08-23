#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# crosscheck-shipped-fixes — confirm B79 and B80 by a DIFFERENT method than the
# lenses that originally reported them.
#
# WHY THIS EXISTS. The four `verify-*.mjs` lenses share a stack: Playwright, one
# postgres.js client, and assertion code I wrote in one sitting. Several of this
# session's false results came from exactly that shared machinery — a truncated
# body before JSON.parse, a DSN pointing at the wrong cluster. A green lens is
# not independent evidence that the thing it measures is true; it is evidence
# that the lens and the product agree, which is a weaker claim.
#
# So this cross-check shares nothing with them: raw HTTP via curl against the
# server's OWN rendered bytes, expectations from psql, no browser, no Node, no
# shared helper. If a lens is wrong, this should disagree with it. That is the
# entire point — a cross-check that cannot dissent is decoration.
#
# It is NOT a fifth lens and should not grow into one. Reach for it when a
# result matters enough that "the harness said so" is not good enough.
#
#   cd frontend && bash scripts/crosscheck-shipped-fixes.sh
# Exit 0 if both fixes hold under an independent method; 1 otherwise.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail
BASE="${GUIDE_BASE:-http://localhost:3001}"
export PGPASSWORD=changeme
PSQL=(psql -h localhost -U govtech -d govtech_intel -tAc)
ADMIN_PW="${SANDBOX_PASSWORD:-SandboxDrive2026!}"
JAR=$(mktemp -d)/jar.txt
OK=0

say()  { echo "$*"; }
pass() { echo "  ✓ $1${2:+ — $2}"; }
fail() { echo "  ✗ $1${2:+ — $2}"; OK=1; }
chk()  { if [ "$2" = "$3" ]; then pass "$1" "$2"; else fail "$1" "got '$2', expected '$3'"; fi; }

# Sign in through the product's real credential flow (CSRF + Auth.js callback),
# not a forged cookie — auth is part of what renders the page.
login() {
  local email="$1" pw="$2" csrf
  rm -f "$JAR"
  csrf=$(curl -s -c "$JAR" "$BASE/api/auth/csrf" | sed -E 's/.*"csrfToken":"([^"]+)".*/\1/')
  curl -s -b "$JAR" -c "$JAR" -o /dev/null -X POST "$BASE/api/auth/callback/credentials" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "csrfToken=$csrf" --data-urlencode "email=$email" \
    --data-urlencode "password=$pw" --data-urlencode 'redirect=false'
  curl -s -b "$JAR" "$BASE/api/auth/session" | grep -q '"email"'
}

say "· ${BASE} · curl + psql only (no Playwright, no shared harness code)"

# ══ B80 · the cockpit summary states the true build count ═══════════════════
say ""
say "══ B80 · \"N active builds\" vs the proposals table ══"
if ! login 'kate.ulepic@foundation3dp.com' 'DemoPass123!'; then
  fail "tenant sign-in" "could not establish a session"
else
  TID=$("${PSQL[@]}" "SELECT id FROM tenants WHERE slug='foundation'")
  # The predicate is the dashboard page's own, read from
  # app/portal/[tenantSlug]/dashboard/page.tsx (activeBuildCount).
  DB=$("${PSQL[@]}" "SELECT count(*) FROM proposals WHERE tenant_id='$TID' AND stage <> 'archived'")
  UI=$(curl -s -b "$JAR" "$BASE/portal/foundation/dashboard" \
       | grep -oE '[0-9]+ active build' | head -1 | grep -oE '^[0-9]+')
  chk "at rest, the page states the stored count" "${UI:-none}" "$DB"

  # The regression that matters: the list is capped at 6, so below the cap a
  # correct and a broken implementation are indistinguishable. Push past it.
  OPP=$("${PSQL[@]}" "SELECT id FROM opportunities ORDER BY id ASC LIMIT 1")
  if [ -z "$OPP" ]; then
    say "  · cap check SKIPPED — no opportunity row to hang scratch builds off"
  else
    for i in 1 2 3 4; do
      "${PSQL[@]}" "INSERT INTO proposals (tenant_id, opportunity_id, title, stage, is_locked)
                    VALUES ('$TID','$OPP','xcheck-probe build $i','draft',false)" >/dev/null
    done
    DB2=$("${PSQL[@]}" "SELECT count(*) FROM proposals WHERE tenant_id='$TID' AND stage <> 'archived'")
    UI2=$(curl -s -b "$JAR" "$BASE/portal/foundation/dashboard" \
          | grep -oE '[0-9]+ active build' | head -1 | grep -oE '^[0-9]+')
    chk "above the 6-card cap, it still states the true total" "${UI2:-none}" "$DB2"
    # Remove ours. These rows are minutes old and carry no children, but derive
    # the child tables anyway rather than trusting that.
    "${PSQL[@]}" "DELETE FROM proposal_sections WHERE proposal_id IN
                    (SELECT id FROM proposals WHERE title LIKE 'xcheck-probe%')" >/dev/null
    "${PSQL[@]}" "DELETE FROM proposals WHERE title LIKE 'xcheck-probe%'" >/dev/null
    LEFT=$("${PSQL[@]}" "SELECT count(*) FROM proposals WHERE title LIKE 'xcheck-probe%'")
    chk "scratch builds removed" "$LEFT" "0"
  fi
fi

# ══ B79 · /admin/events renders a hydration-safe first paint ════════════════
#
# The defect was `Date.now()` read DURING render: the server wrote "2s ago", the
# client hydrated a beat later and computed "4s ago", the text mismatched, React
# #418 fired and took the subtree to its error boundary — at status 200.
#
# A browser check asks "did a boundary appear". This asks the question one level
# down, where the bug actually lived: does the SERVER's first paint contain a
# time string that is a function of when it rendered? An absolute UTC stamp is
# deterministic and cannot mismatch; a relative one is the bug's signature.
say ""
say "══ B79 · /admin/events first paint is deterministic ══"
if ! login 'eric@rfppipeline.com' "$ADMIN_PW"; then
  fail "admin sign-in" "could not establish a session"
else
  HTML=$(curl -s -b "$JAR" "$BASE/admin/events")
  # NOTE: grep -c counts matching LINES, and server-rendered HTML is a single
  # enormous line — so -c reports 1 for "many" and understates every count. Use
  # -o | wc -l so the numbers printed below mean what they say.
  BOUNDARY=$(printf '%s' "$HTML" | grep -oiE 'Something went wrong|Application error|Unhandled Runtime Error' | wc -l | tr -d ' ')
  chk "no error surface in the server's own bytes" "$BOUNDARY" "0"
  # Rendered rows exist at all — otherwise the checks below are vacuously green.
  ROWS=$(printf '%s' "$HTML" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}' | wc -l | tr -d ' ')
  if [ "$ROWS" -gt 0 ]; then
    pass "the first paint carries absolute timestamps" "$ROWS line(s)"
  else
    fail "the first paint carries absolute timestamps" "found none — check the page actually rendered rows"
  fi
  RELATIVE=$(printf '%s' "$HTML" | grep -oE '\b[0-9]+ (second|minute|hour)s? ago\b|\b[0-9]+[smh] ago\b' | wc -l | tr -d ' ')
  chk "and no render-time relative string (the #418 signature)" "$RELATIVE" "0"
fi

say ""
if [ "$OK" -eq 0 ]; then
  say "✓ both fixes hold under a method that shares nothing with the lenses."
else
  say "✗ the cross-check disagrees with the lenses — trust this one and re-open."
fi
exit "$OK"
