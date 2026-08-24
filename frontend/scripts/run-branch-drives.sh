#!/usr/bin/env bash
# Run every BRANCH drive against the live rig and print one table.
#
# `drive-end-to-end.mjs` proves the happy spine on one artifact: ingest → curate → push → buy →
# provision → author → lock → package. It deliberately does not fork. The branches — award,
# amendment, archive, collaborator, partner, the HITL gates — each have their own drive, and until
# now they were run one at a time by hand, which is how one quietly stops being run at all.
#
# Every drive here already existed. What did not exist was a single command that runs them all and
# says, in one place, which ones pass TODAY against the build that is actually serving.
#
# WHAT A FAILURE MEANS. Nothing is skipped and nothing is swallowed: a drive that fails prints its
# name, its exit code and the tail of its log, and the script exits non-zero. A drive that cannot
# run for an environmental reason (missing fixture, absent seed) is still a FAILURE here — it is
# uncovered, not passing, the same rule the four lenses use.
#
#   ./scripts/run-branch-drives.sh            all drives
#   ./scripts/run-branch-drives.sh amendment  only names matching a substring
set -uo pipefail

cd "$(dirname "$0")/.." || exit 2
OUT="${OUT_DIR:-/tmp/branch-drives}"
mkdir -p "$OUT"
FILTER="${1:-}"

# THE DEFAULTS ARE THE TWO ROLES, not one role twice. Defaulting both to the owner made every
# isolation drive refuse ("RLS posture wrong") on the plainest possible invocation — safe, since a
# bypassed layer makes an isolation verdict meaningless rather than merely wrong, but it meant the
# obvious command measured nothing. Defaulting both to the app role would flip the problem onto the
# scenario drives, which create companies and need the owner. Each default is now the role its own
# group requires; either can still be overridden from the environment.
export DATABASE_URL="${DATABASE_URL:-postgresql://govtech_app:changeme@localhost:5432/govtech_intel}"
export DATABASE_URL_OWNER="${DATABASE_URL_OWNER:-postgresql://govtech:changeme@localhost:5432/govtech_intel}"
# The SCOPED role by name, always — a scenario drive is handed the owner as DATABASE_URL, so a
# check whose meaning is "RLS denied it" needs a way to reach the app role regardless.
export DATABASE_URL_APP="${DATABASE_URL_APP:-postgresql://govtech_app:changeme@localhost:5432/govtech_intel}"
export GUIDE_BASE="${GUIDE_BASE:-http://localhost:3000}"
# The harness's OWN bookkeeping reads across tenants, so it uses the owner regardless of posture.
export GUIDE_DB="${GUIDE_DB:-$DATABASE_URL_OWNER}"
export SANDBOX_PASSWORD="${SANDBOX_PASSWORD:-SandboxDrive2026!}"
export RFP_ADMIN_PW="${RFP_ADMIN_PW:-$SANDBOX_PASSWORD}"
export TENANT_PW="${TENANT_PW:-DemoPass123!}"
export BUYER_PW="${BUYER_PW:-$TENANT_PW}"
export FOUNDATION_PW="${FOUNDATION_PW:-$TENANT_PW}"
export PASSWORD="${PASSWORD:-$TENANT_PW}"
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
export ATOM_EMBED="${ATOM_EMBED:-local}"
export STORAGE_DRIVER="${STORAGE_DRIVER:-local}"

# ── RESOLVE THE FIXTURE ONCE, AND HAND IT TO EVERY DRIVE ────────────────────────────────────────
#
# Several drives already read TEST_TENANT_ID / TEST_TENANT_SLUG and fall back to a hardcoded uuid
# when they are unset. That fallback is a dead tenant on any rebuilt database, and the drives fail
# with an FK violation on tenant_id — which looks nothing like "your fixture moved", so it reads as
# a product bug. Exporting a resolved value makes the fallback unreachable.
#
# The tenant chosen is the one with the most to lose: driving isolation against an empty tenant
# proves nothing, because every check would pass on nothing.
# These three lookups are the RUNNER's own bookkeeping and read ACROSS tenants, so they use the
# owner. Run as the scoped app role with no tenant context they would not error — they would
# silently count zero proposals and zero cards for every tenant and pick the "busiest" one at
# random, which is the worst of both worlds: a fixture chosen by nothing, reported as chosen.
if [ -z "${TEST_TENANT_ID:-}" ]; then
  read -r _tid _tslug <<<"$(psql "$DATABASE_URL_OWNER" -tAF' ' -c "
    SELECT x.id, x.slug FROM (
      SELECT t.id, t.slug,
             (SELECT count(*) FROM proposals p WHERE p.tenant_id = t.id) AS n1,
             (SELECT count(*) FROM tenant_opportunity_cards c WHERE c.tenant_id = t.id) AS n2
      FROM tenants t
      WHERE EXISTS (SELECT 1 FROM users u
                    WHERE u.tenant_id = t.id AND u.is_active AND u.role = 'tenant_admin')
    ) x ORDER BY x.n1 + x.n2 DESC LIMIT 1" 2>/dev/null)"
  if [ -n "${_tid:-}" ]; then
    export TEST_TENANT_ID="$_tid" TEST_TENANT_SLUG="$_tslug"
    # The ACTOR is pinned in several drives too — `owner_user_id` FK violations are the same rot,
    # one field further in. Resolve a real tenant_admin of the chosen tenant.
    _aid=$(psql "$DATABASE_URL_OWNER" -tAc "
      SELECT u.id FROM users u
      WHERE u.tenant_id = '$_tid' AND u.is_active AND u.role = 'tenant_admin'
      ORDER BY u.created_at LIMIT 1" 2>/dev/null | tr -d ' ')
    [ -n "$_aid" ] && export TEST_ACTOR_ID="$_aid"
    echo "fixture: tenant=$_tslug ($_tid) actor=${_aid:-UNRESOLVED}"
    echo
  else
    echo "WARNING: could not resolve a tenant — drives that need one will report CANT-RUN" >&2
  fi
fi

# ── PREFLIGHT: is this box enforcing RLS, or only appearing to? (bug log B86) ───────────────────
#
# A superuser connection bypasses row-level security entirely, and a run against one produces
# isolation output indistinguishable from a perfectly isolated box. An entire session's worth of
# "RLS proven" once came from exactly that. So the posture is checked BEFORE anything runs.
#
# It does not abort the suite: the non-isolation drives still measure real things. What it does is
# refuse to let the isolation drives report a verdict they cannot earn — they are marked CANT-RUN,
# which is uncovered rather than passing, and the banner says why.
# The cross-tenant invariant: nothing reads or writes cross-tenant, ever. Checked here rather than
# when someone remembers, because the one violation that existed (303 atom_lineage edges) sat
# unnoticed for months in a link table no tenant-column sweep could see.
if node scripts/check-tenant-isolation-invariant.mjs > "$OUT/tenant-invariant.log" 2>&1; then
  echo "tenant isolation: no cross-tenant references"
else
  echo "╔══════════════════════════════════════════════════════════════════════════════════════╗"
  echo "║ CROSS-TENANT REFERENCES EXIST — data must move by inward COPY, never by reference.    ║"
  echo "╚══════════════════════════════════════════════════════════════════════════════════════╝"
  sed 's/^/  /' "$OUT/tenant-invariant.log" | tail -12
fi

# ── PREFLIGHT: does anything in this suite still point at a row that no longer exists? ──────────
#
# Fixture rot is silent by construction: a drive that pins a uuid keeps reporting a verdict after
# the row is gone, and the verdict looks like a regression in whatever the drive tests. Eight
# confident, wrong findings came out of exactly that this week (B98-B101). This asks the live
# database about every uuid and email literal in the suite, the four lenses and the guide capture,
# and names any that are dead and REACHABLE (a literal behind an env-var fallback the runner
# already resolves is not reachable; one a script is about to CREATE is not rot).
#
# It does not abort — the drives still measure real things — but a non-zero count here means some
# green below may be green about nothing, so it is said loudly and first.
if node scripts/audit-pinned-fixtures.mjs > "$OUT/pinned-fixtures.log" 2>&1; then
  echo "fixtures: nothing in the suite points at a row that no longer exists"
else
  echo "╔══════════════════════════════════════════════════════════════════════════════════════╗"
  echo "║ FIXTURE ROT — a drive below can drive an identifier that is GONE. Its verdict may be  ║"
  echo "║ about nothing at all. Resolve it or build it; see TESTING_STRATEGY.md.                ║"
  echo "╚══════════════════════════════════════════════════════════════════════════════════════╝"
  sed -n '/LIVE SAFETY NET/,/^$/p' "$OUT/pinned-fixtures.log" | sed 's/^/  /'
fi

RLS_OK=1
if node scripts/check-rls-posture.mjs > "$OUT/rls-posture.log" 2>&1; then
  echo "RLS posture: correct (isolation results from this box mean what they say)"
else
  RLS_OK=0
  echo "╔══════════════════════════════════════════════════════════════════════════════════════╗"
  echo "║ RLS POSTURE WRONG — the isolation drives will be reported as CANT-RUN, not run.       ║"
  echo "║ A bypassed database layer produces the same output as a perfectly isolated one, so    ║"
  echo "║ their verdicts would be meaningless. Everything else still runs.                      ║"
  echo "╚══════════════════════════════════════════════════════════════════════════════════════╝"
  sed 's/^/  /' "$OUT/rls-posture.log" | head -8
fi
echo

# Drives whose entire value is an isolation claim. Meaningless in the wrong posture.
# Drives whose entire value is an isolation claim MADE THROUGH THE DATABASE. Meaningless in the
# wrong posture, so the runner marks them CANT-RUN rather than letting them report a verdict.
# `vault-isolation` left this list when it moved onto the factory: six of its seven checks are
# APP-layer (resolveVaultAccess), which the posture does not affect, and its one RLS check now
# gates itself on the role it lands on and reports NOT MEASURED when that role can bypass.
ISOLATION_DRIVES="rls-app rls-admin rls-portal rls-pages collaborator-boundary"

# ── TWO ROLES, BECAUSE THE SUITE GENUINELY NEEDS BOTH ────────────────────────────────────────────
#
# This is not a preference, it is a conflict of requirements that only became visible once the
# scenario drives existed:
#
#   ISOLATION drives must run with DATABASE_URL = the SCOPED app role. That is the whole point —
#   under the owner, RLS is bypassed and "no cross-tenant rows visible" is unfalsifiable (B86).
#
#   SCENARIO drives must run with DATABASE_URL = the OWNER. They CREATE tenants through the
#   product's own helpers, and those helpers use the context-aware `sql`; under a scoped role with
#   no tenant context the writes are half-applied — tenant yes, membership no — and the drive then
#   fails on session assertions that have nothing to do with the product.
#
# Running the whole suite under either role makes the other group CANT-RUN. So each group gets the
# connection its job requires, and the scenario factory refuses loudly if it is ever handed the
# wrong one rather than half-working.
SCENARIO_DRIVES="pin identity-deeplink partner-lifecycle partner-invite scenario-factory scenario-matrix shadow-tenant-admin spine-section-todo atomization vault-isolation award-to-contract uncovered-triggers cms-generate canvas-authoring"

# label | script — the branches the spine drive does not fork into.
DRIVES=(
  # FIRST, because nine of the drives below now stand on it. The factory is load-bearing: one that
  # silently builds half a scenario, or disposes incompletely, would make every drive above it
  # report confidently about a situation that was never constructed — and the leak would accumulate
  # under every future run. Its self-test counts the world, builds, asserts each piece is real and
  # usable, disposes, and asserts the world is identical again. Validate the instrument, then use it.
  "scenario-factory|scripts/drive-scenario-factory.mts"
  "award-to-contract|scripts/drive-award-to-contract.mts"
  # `amendment` takes a <solicitationId>. Passing none made it print usage and exit 1, which the
  # table reported as a failing amendment flow rather than a missing argument. Resolved below.
  "amendment|scripts/drive-amendment.mjs|SOLICITATION"
  "provisioning-cockpit|scripts/drive-provisioning-cockpit.mts"
  "tenant-workflow-setup|scripts/drive-tenant-workflow-setup.mts"
  "scout-intake|scripts/drive-scout-intake.mts"
  "opp-scout|scripts/drive-opp-scout.mts"
  "submit-gate|scripts/drive-submit-gate.mts"
  "review-gate|scripts/drive-review-gate.mts"
  "full-draft|scripts/drive-full-draft.mts"
  "collaborator-boundary|scripts/drive-collaborator-boundary.mts"
  "partner-lifecycle|scripts/drive-p3-lifecycle.mts"
  "partner-invite|scripts/drive-p3-invite.mts"
  "starter-offer|scripts/drive-starter-offer.mts"
  "copy-starter|scripts/drive-copy-starter.mts"
  "shadow-tenant-admin|scripts/drive-shadow-tenant-admin.mts"
  "rls-app|scripts/drive-rls-app.mjs"
  "rls-admin|scripts/drive-rls-admin.mjs"
  "rls-portal|scripts/drive-rls-portal.mjs"
  "rls-pages|scripts/drive-rls-pages.mjs"
  "atomization|scripts/drive-atomization.mts"
  "bridge-buckets|scripts/drive-bridge-buckets.mjs"
  "pin|scripts/drive-pin.mts"
  "identity-deeplink|scripts/drive-identity-deeplink.mts"
  "vault-isolation|scripts/drive-vault-isolation.mts"
  "spine-section-todo|scripts/drive-spine-t1-section-todo.mts"
  "spine-buildout|scripts/drive-spine-t4-buildout.mts"
  "spine-anchor|scripts/drive-spine-t7-anchor.mts"
  # Fires the domain emitters the AI_INVOKE contract lens has never observed. Runs LAST because
  # it deliberately leaves its audit events behind — they ARE the coverage evidence (B103).
  "uncovered-triggers|scripts/drive-uncovered-triggers.mts"
  "cms-generate|scripts/drive-cms-generate.mts"
  "cms-publish|scripts/close-e2e-cms.mjs"
  # Authors NEW documents from a blank canvas as both actors and takes them out in all four formats.
  # It needs the OWNER for its own bookkeeping (reading back the saved row), which the runner already
  # exports; it creates tenant_documents rows and leaves them, deliberately — they are a customer's
  # own documents, not fixture, and a tenant with a few extra drafts is the realistic state.
  "canvas-authoring|scripts/drive-canvas-authoring.mts"
  # The four structural primitives, each measured by the effect it actually has. No server needed.
  "canvas-structural|scripts/probe-structural-nodes.mts"
)

pass=0; fail=0; missing=0; cantrun=0
declare -a FAILED=()   # initialised: `${#FAILED[@]}` on a declared-but-unset array trips `set -u`

printf '%-24s %-8s %s\n' "DRIVE" "RESULT" "DETAIL"
printf '%-24s %-8s %s\n' "------------------------" "--------" "------"

for entry in "${DRIVES[@]}"; do
  label="${entry%%|*}"; rest="${entry#*|}"; script="${rest%%|*}"; argspec="${rest#*|}"
  [ "$argspec" = "$script" ] && argspec=""
  # Resolve a positional argument the drive needs. A drive that wants one and gets none prints its
  # usage and exits 1, which is indistinguishable in a table from the flow being broken.
  drive_args=""
  if [ "$argspec" = "SOLICITATION" ]; then
    drive_args=$(psql "$DATABASE_URL_OWNER" -tAc "
      SELECT cs.id FROM curated_solicitations cs
      WHERE EXISTS (SELECT 1 FROM solicitation_volumes v WHERE v.solicitation_id = cs.id)
      ORDER BY cs.created_at DESC LIMIT 1" 2>/dev/null | tr -d ' ')
    if [ -z "$drive_args" ]; then
      printf '%-24s %-8s %s\n' "$label" "CANT-RUN" "no curated solicitation with volumes to drive against"
      cantrun=$((cantrun+1)); FAILED+=("$label"); continue
    fi
  fi
  [ -n "$FILTER" ] && [[ "$label" != *"$FILTER"* ]] && continue

  if [ ! -f "$script" ]; then
    printf '%-24s %-8s %s\n' "$label" "MISSING" "$script does not exist"
    missing=$((missing+1)); FAILED+=("$label (missing)"); continue
  fi

  if [ "$RLS_OK" -eq 0 ] && [[ " $ISOLATION_DRIVES " == *" $label "* ]]; then
    printf '%-24s %-8s %s\n' "$label" "CANT-RUN" "RLS posture wrong — an isolation verdict here would be meaningless"
    cantrun=$((cantrun+1)); FAILED+=("$label"); continue
  fi

  log="$OUT/$label.log"
  # Hand this drive the connection its job needs (see SCENARIO_DRIVES above).
  drive_db="$DATABASE_URL"
  if [[ " $SCENARIO_DRIVES " == *" $label "* ]]; then drive_db="$DATABASE_URL_OWNER"; fi
  if [[ "$script" == *.mts ]]; then
    DATABASE_URL="$drive_db" timeout 900 node --import tsx "$script" $drive_args > "$log" 2>&1
  else
    DATABASE_URL="$drive_db" timeout 900 node "$script" $drive_args > "$log" 2>&1
  fi
  code=$?

  # EXIT 2 MEANS "COULD NOT RUN", AND THAT IS NOT THE SAME AS A FINDING.
  #
  # A drive that cannot authenticate, or cannot find the fixture it needs, measures nothing — and
  # a logged-out browser gets 401 on every route, which reads exactly like a deny-all. Collapsing
  # the two is how `drive-rls-app` came to print "a DENY-ALL surfaced" having never logged in
  # (docs/E2E_SWEEP_2026-08-23.md §3). Both still count against the suite — uncovered is not
  # passing — but the table says which is which, because they need different fixes.
  if [ $code -eq 0 ]; then
    printf '%-24s %-8s %s\n' "$label" "pass" "$(wc -l < "$log") log lines"
    pass=$((pass+1))
  elif [ $code -eq 2 ]; then
    why=$(grep -A1 'CANNOT RUN' "$log" | tail -1 | sed 's/^ *//' | cut -c1-92)
    printf '%-24s %-8s %s\n' "$label" "CANT-RUN" "${why:-exit 2, no reason given}"
    cantrun=$((cantrun+1)); FAILED+=("$label")
  else
    last=$(grep -vE '^\s*(at |$)' "$log" | tail -1 | cut -c1-96)
    printf '%-24s %-8s %s\n' "$label" "FAIL($code)" "$last"
    fail=$((fail+1)); FAILED+=("$label")
  fi
done

echo
echo "── ${pass} passed · ${fail} failed · ${cantrun} could-not-run · ${missing} missing ──"
echo "   (could-not-run measured NOTHING — it is uncovered, not passing, and not a finding)"
# Decide on the COUNTERS, not on the array — an empty array expansion is exactly what tripped
# `set -u` here and made a fully green run exit with a shell error.
if [ $((fail + cantrun + missing)) -gt 0 ]; then
  echo "logs for the failures:"
  for f in ${FAILED[@]+"${FAILED[@]}"}; do echo "  $OUT/${f%% *}.log"; done
  exit 1
fi
exit 0
