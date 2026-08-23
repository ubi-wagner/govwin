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

export DATABASE_URL="${DATABASE_URL:-postgresql://govtech:changeme@localhost:5432/govtech_intel}"
export DATABASE_URL_OWNER="${DATABASE_URL_OWNER:-$DATABASE_URL}"
export GUIDE_BASE="${GUIDE_BASE:-http://localhost:3000}"
export GUIDE_DB="${GUIDE_DB:-$DATABASE_URL}"
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
if [ -z "${TEST_TENANT_ID:-}" ]; then
  read -r _tid _tslug <<<"$(psql "$DATABASE_URL" -tAF' ' -c "
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
    _aid=$(psql "$DATABASE_URL" -tAc "
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

# label | script — the branches the spine drive does not fork into.
DRIVES=(
  "award-to-contract|scripts/drive-award-to-contract.mjs"
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
  "atomization|scripts/drive-atomization.mjs"
  "bridge-buckets|scripts/drive-bridge-buckets.mjs"
  "pin|scripts/drive-pin.mts"
  "identity-deeplink|scripts/drive-identity-deeplink.mts"
  "vault-isolation|scripts/drive-vault-isolation.mts"
  "spine-section-todo|scripts/drive-spine-t1-section-todo.mts"
  "spine-buildout|scripts/drive-spine-t4-buildout.mts"
  "spine-anchor|scripts/drive-spine-t7-anchor.mts"
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
    drive_args=$(psql "$DATABASE_URL" -tAc "
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

  log="$OUT/$label.log"
  if [[ "$script" == *.mts ]]; then
    timeout 900 node --import tsx "$script" $drive_args > "$log" 2>&1
  else
    timeout 900 node "$script" $drive_args > "$log" 2>&1
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
