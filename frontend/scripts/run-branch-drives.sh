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

# label | script — the branches the spine drive does not fork into.
DRIVES=(
  "award-to-contract|scripts/drive-award-to-contract.mjs"
  "amendment|scripts/drive-amendment.mjs"
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

pass=0; fail=0; missing=0
declare -a FAILED

printf '%-24s %-8s %s\n' "DRIVE" "RESULT" "DETAIL"
printf '%-24s %-8s %s\n' "------------------------" "--------" "------"

for entry in "${DRIVES[@]}"; do
  label="${entry%%|*}"; script="${entry##*|}"
  [ -n "$FILTER" ] && [[ "$label" != *"$FILTER"* ]] && continue

  if [ ! -f "$script" ]; then
    printf '%-24s %-8s %s\n' "$label" "MISSING" "$script does not exist"
    missing=$((missing+1)); FAILED+=("$label (missing)"); continue
  fi

  log="$OUT/$label.log"
  if [[ "$script" == *.mts ]]; then
    timeout 900 node --import tsx "$script" > "$log" 2>&1
  else
    timeout 900 node "$script" > "$log" 2>&1
  fi
  code=$?

  if [ $code -eq 0 ]; then
    printf '%-24s %-8s %s\n' "$label" "pass" "$(wc -l < "$log") log lines"
    pass=$((pass+1))
  else
    last=$(grep -vE '^\s*(at |$)' "$log" | tail -1 | cut -c1-96)
    printf '%-24s %-8s %s\n' "$label" "FAIL($code)" "$last"
    fail=$((fail+1)); FAILED+=("$label")
  fi
done

echo
echo "── ${pass} passed · ${fail} failed · ${missing} missing ──"
if [ ${#FAILED[@]} -gt 0 ]; then
  echo "logs for the failures:"
  for f in "${FAILED[@]}"; do echo "  $OUT/${f%% *}.log"; done
  exit 1
fi
exit 0
