#!/usr/bin/env bash
# Rebuild every drive scenario the e2e suite needs, and only the missing ones.
#
# WHY THIS EXISTS. A container restart takes the ingested BAAs with it. seed_dev_accounts.mjs
# restores the tenant and the logins, so the stack probes healthy and the box looks drivable — but
# the heavy drive specs each claim a SCENARIO of their own (docs/FIXTURE_INTEGRITY.md, "owned
# scenarios"), and those are ordinary rows nothing recreates. The resolver then refuses, correctly
# and loudly, and six or seven specs go red for a reason that is not a code defect. That happened
# twice before this script existed.
#
# THE OWNER LIST IS DERIVED, NOT DECLARED. Every owner is read out of the spec call sites, because
# a hand-maintained copy is precisely what went wrong: an earlier grep for the literal "[owned:"
# marker found four owners and missed "flex", which is passed as an argument rather than written
# into a title. A list that can drift from its source will drift from its source.
#
# Each scenario is built by driving the PRODUCT'S OWN upload + async shred, not a SQL insert, so a
# rebuilt fixture exercises the same path a real solicitation does.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/sandbox-env.sh"

BAA="docs/DoD 25.2 SBIR BAA FULL_04212025.pdf"
SHARED_BAA="docs/DoW 2026 SBIR BAA FULL_R1_04132026.pdf"
MIN_CHARS=100000
FORCE="${FORCE:-0}"

have_owned() {
  psql "$DATABASE_URL_OWNER" -tAc \
    "SELECT count(*) FROM curated_solicitations cs
       JOIN opportunities o ON o.id = cs.opportunity_id
      WHERE cs.full_text IS NOT NULL AND length(cs.full_text) > ${MIN_CHARS}
        AND o.title LIKE '%[owned:${1}]%'" 2>/dev/null | tr -d ' '
}

have_shared() {
  psql "$DATABASE_URL_OWNER" -tAc \
    "SELECT count(*) FROM curated_solicitations cs
       LEFT JOIN opportunities o ON o.id = cs.opportunity_id
      WHERE cs.full_text IS NOT NULL AND length(cs.full_text) > ${MIN_CHARS}
        AND coalesce(o.title,'') NOT LIKE '%[owned:%'" 2>/dev/null | tr -d ' '
}

owners="$(grep -rhoE "resolveShreddedSolicitation\([^)]*'[a-z0-9]+'\)" "$ROOT/frontend/e2e"/*.ts \
          | grep -oE "'[a-z0-9]+'\)$" | tr -d "')" | sort -u)"

[ -n "$owners" ] || { echo "no owned scenarios found in e2e call sites — nothing to do"; exit 0; }
echo "owners derived from spec call sites: $(echo "$owners" | tr '\n' ' ')"

built=0 kept=0
cd "$ROOT/frontend"

for owner in $owners; do
  if [ "$FORCE" != "1" ] && [ "$(have_owned "$owner")" -ge 1 ]; then
    echo "  [owned:$owner] present — skipping"
    kept=$((kept + 1)); continue
  fi
  echo "  [owned:$owner] MISSING — building through the product's upload + shred…"
  node scripts/drive-ingest-scenario.mjs \
    "FLEX mid-window scenario [owned:${owner}]" baa 2026-12-15 "$BAA" >/dev/null 2>&1 \
    || { echo "  [owned:$owner] BUILD FAILED"; exit 1; }
  [ "$(have_owned "$owner")" -ge 1 ] || { echo "  [owned:$owner] built but still not resolvable"; exit 1; }
  echo "  [owned:$owner] built"
  built=$((built + 1))
done

# The shared pool is what a spec resolves when it claims no owner. Easy to forget precisely because
# no spec names it.
if [ "$FORCE" != "1" ] && [ "$(have_shared)" -ge 1 ]; then
  echo "  shared-pool present — skipping"
  kept=$((kept + 1))
else
  echo "  shared-pool MISSING — building…"
  node scripts/drive-ingest-scenario.mjs \
    "DoW 2026 SBIR BAA (R1)" baa 2026-12-15 "$SHARED_BAA" >/dev/null 2>&1 \
    || { echo "  shared-pool BUILD FAILED"; exit 1; }
  [ "$(have_shared)" -ge 1 ] || { echo "  shared-pool built but still not resolvable"; exit 1; }
  echo "  shared-pool built"
  built=$((built + 1))
fi

echo "drive scenarios: ${built} built, ${kept} already present — all resolvable"
