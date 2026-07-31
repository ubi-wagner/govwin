#!/usr/bin/env bash
# One-command Foundation TVSF seed — runs the whole chain against a RUNNING, migrated
# instance (fresh DB recommended for a clean, dup-free seed).
#
#   Prereqs: DATABASE_URL set; a server on TEST_BASE_URL (default :3000); migrations applied;
#            scripts/seed_dev_accounts.mjs already run (gives the rfp-pipeline admin).
#   Run:     DATABASE_URL=... TEST_BASE_URL=http://localhost:3000 bash scripts/seed-foundation-all.sh
#
# Steps: HITL cohort → load TVSF (dated) + SBIR opps → seed Foundation (tenant/founders/Paul/
# buckets/atoms/scores) → comp-purchase + release/provision → draft+lock+advance+export →
# verify (Kate download + Paul sees buckets/pipeline/proposal). See FOUNDATION_TVSF_SEED.md.
: "${DATABASE_URL:?set DATABASE_URL}"
BASE="${TEST_BASE_URL:-http://localhost:3000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export DATABASE_URL AWS_S3_BUCKET_NAME="${AWS_S3_BUCKET_NAME:-rfp-pipeline-local}" AWS_REGION="${AWS_REGION:-us-east-1}"

echo "== 1/5  HITL cohort + load Foundation-relevant opportunities =="
node scripts/seed-e2e-hitl.mjs >/dev/null && echo "  ✓ e2e-hitl cohort"
LOAD="$(cd frontend && TEST_BASE_URL="$BASE" npx playwright test --project=hitl hitl-load-tvsf.spec.ts --reporter=line 2>&1)"
OPP="$(printf '%s' "$LOAD" | grep -oE 'OPPID=[0-9a-f-]+' | head -1 | cut -d= -f2)"
[ -n "$OPP" ] || { echo "FATAL: no TVSF OPPID (is the server up + seeded?)"; printf '%s\n' "$LOAD" | tail -20; exit 1; }
echo "  ✓ TVSF loaded (OPP=$OPP)"
psql "$DATABASE_URL" -c "UPDATE opportunities SET open_date=now()-interval '14 days', posted_date=now()-interval '14 days', close_date=now()+interval '14 days' WHERE id='$OPP'" >/dev/null && echo "  ✓ TVSF back-dated (open 2wk ago / close 2wk out)"
(cd frontend && TEST_BASE_URL="$BASE" npx playwright test --project=hitl hitl-load-sbir.spec.ts --reporter=line 2>&1 | grep -E '1 passed|failed') && echo "  ✓ SBIR/STTR opps loaded"

echo "== 2/5  Seed Foundation (tenant / founders / Paul shadow-admin / buckets / atoms / scores) =="
node scripts/seed-foundation.mjs | tail -9

echo "== 3/5  Comp-purchase (Kate) + release/provision (rfp_admin) =="
(cd frontend && TEST_BASE_URL="$BASE" TVSF_OPP="$OPP" npx playwright test --project=hitl hitl-foundation-build.spec.ts --reporter=line 2>&1 | grep -E 'PROPOSAL_ID|1 passed|failed')

echo "== 4/5  Draft 13 sections + lock (matrix satisfied) + advance→submitted + export =="
(cd frontend && node --import tsx scripts/drive-foundation-tvsf.mts | tail -9)

echo "== 5/5  Verify — Kate downloads final proposal; Paul sees buckets/pipeline/proposal =="
(cd frontend && TEST_BASE_URL="$BASE" npx playwright test --project=hitl hitl-foundation-verify.spec.ts --reporter=line 2>&1 | grep -E '2 passed|passed|failed')

echo ""
echo "== DONE — Foundation TVSF seed complete =="
echo "   Login: kate.ulepic@foundation3dp.com / pjackson@ecinnovates.com  (pw DemoPass123!)"
echo "   Deliverables: docs/proposals/foundation-tvsf/*.docx | *.xlsx"
