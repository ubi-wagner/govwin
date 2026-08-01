#!/usr/bin/env bash
# Screenshot tour orchestrator: UI steps 1-6 (select→purchase→release→provision→agent drafter),
# then inject the deck-grounded section content (no sandbox LLM key), then UI steps 7-11
# (content→matrix→lock→advance→download). Needs a running server + the clean TVSF slate.
: "${DATABASE_URL:?set DATABASE_URL}"
BASE="${TEST_BASE_URL:-http://localhost:3000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
export DATABASE_URL AWS_S3_BUCKET_NAME="${AWS_S3_BUCKET_NAME:-rfp-pipeline-local}" AWS_REGION=us-east-1
cd frontend
echo "== UI steps 1-6 (select → purchase → release → provision → agent drafter) =="
TEST_BASE_URL="$BASE" npx playwright test hitl-foundation-ui-walk.spec.ts -g "step (1|2|4|5|6)" --reporter=line 2>&1 | grep -E "📸|passed|failed|Error" || true
echo "== inject deck-grounded section content (DRAFT_ONLY) =="
DRAFT_ONLY=1 node --import tsx scripts/drive-foundation-tvsf.mts | tail -4
echo "== UI steps 7-11 (content → matrix → lock → advance → download) =="
TEST_BASE_URL="$BASE" npx playwright test hitl-foundation-ui-walk.spec.ts -g "step (7|8|9|10|11)" --reporter=line 2>&1 | grep -E "📸|⬇|passed|failed|Error" || true
echo "== DONE — screenshots in docs/proposals/foundation-tvsf/ui-walkthrough/ =="
