#!/bin/bash
# ============================================================================
# GovWin — 1-touch test runner
#
# Runs all test layers in sequence:
#   1. Type checking (frontend)
#   2. Unit tests (frontend logic + Python pipeline)
#   3. Integration tests (DB schema, API queries, auth flows)
#   4. E2E tests (Playwright user journeys) — optional, requires running server
#
# Usage:
#   ./scripts/test-all.sh              # Run unit + integration tests
#   ./scripts/test-all.sh --e2e        # Also run Playwright E2E tests
#   ./scripts/test-all.sh --unit-only  # Only unit tests (no DB needed)
#   ./scripts/test-all.sh --ci         # CI mode: all tests including E2E
#
# Prerequisites:
#   - Node.js + npm (frontend)
#   - Python 3 + pytest (pipeline)
#   - PostgreSQL running locally (for integration tests)
#   - Running Next.js server on port 3099 (for E2E tests)
#
# Environment:
#   TEST_DATABASE_URL — Postgres connection for test DB (default: govtech_intel_test)
#   TEST_BASE_URL     — Next.js server URL (default: http://localhost:3099)
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
FRONTEND_DIR="$ROOT_DIR/frontend"
PIPELINE_DIR="$ROOT_DIR/pipeline"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse args
RUN_E2E=false
UNIT_ONLY=false
CI_MODE=false

for arg in "$@"; do
  case $arg in
    --e2e)      RUN_E2E=true ;;
    --unit-only) UNIT_ONLY=true ;;
    --ci)       CI_MODE=true; RUN_E2E=true ;;
    *)          echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# Track results
PASSED=0
FAILED=0
SKIPPED=0
RESULTS=()

run_step() {
  local name="$1"
  local cmd="$2"
  local dir="${3:-$ROOT_DIR}"

  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  $name${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

  if (cd "$dir" && eval "$cmd"); then
    echo -e "${GREEN}  ✓ $name — PASSED${NC}"
    RESULTS+=("${GREEN}✓${NC} $name")
    ((PASSED++))
  else
    echo -e "${RED}  ✗ $name — FAILED${NC}"
    RESULTS+=("${RED}✗${NC} $name")
    ((FAILED++))
  fi
}

skip_step() {
  local name="$1"
  local reason="$2"
  echo -e "${YELLOW}  ⊘ $name — SKIPPED ($reason)${NC}"
  RESULTS+=("${YELLOW}⊘${NC} $name — $reason")
  ((SKIPPED++))
}

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              GovWin Test Suite                              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"

# ── 1. Type checking ──
run_step "TypeScript type check" "npx tsc --noEmit" "$FRONTEND_DIR"

# ── 2. Frontend unit tests ──
run_step "Frontend unit tests (Vitest)" \
  "npx vitest run --reporter=verbose __tests__/api-guards.test.ts __tests__/middleware.test.ts" \
  "$FRONTEND_DIR"

# ── 3. Python pipeline unit tests ──
if [ -d "$PIPELINE_DIR" ] && command -v python3 &> /dev/null; then
  run_step "Pipeline unit tests (pytest)" \
    "python3 -m pytest tests/ -v --tb=short" \
    "$PIPELINE_DIR"
else
  skip_step "Pipeline unit tests (pytest)" "python3 or pipeline/ not found"
fi

# ── 4. Integration tests (require PostgreSQL) ──
if [ "$UNIT_ONLY" = true ]; then
  skip_step "Integration tests" "--unit-only flag"
else
  export TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://govtech:changeme@localhost:5432/govtech_intel_test}"

  # Check if PostgreSQL is reachable
  if command -v pg_isready &> /dev/null && pg_isready -q 2>/dev/null; then
    run_step "DB schema & seed data" \
      "npx vitest run --reporter=verbose __tests__/integration/db-schema.test.ts" \
      "$FRONTEND_DIR"

    run_step "Auth flow integration" \
      "npx vitest run --reporter=verbose __tests__/integration/auth-flow.test.ts" \
      "$FRONTEND_DIR"

    run_step "Opportunities API integration" \
      "npx vitest run --reporter=verbose __tests__/integration/api-opportunities.test.ts" \
      "$FRONTEND_DIR"

    run_step "Tenants API integration" \
      "npx vitest run --reporter=verbose __tests__/integration/api-tenants.test.ts" \
      "$FRONTEND_DIR"

    run_step "Pipeline API integration" \
      "npx vitest run --reporter=verbose __tests__/integration/api-pipeline.test.ts" \
      "$FRONTEND_DIR"
  else
    skip_step "Integration tests" "PostgreSQL not reachable"
  fi
fi

# ── 5. E2E tests (require running server) ──
if [ "$RUN_E2E" = true ]; then
  export TEST_BASE_URL="${TEST_BASE_URL:-http://localhost:3099}"

  # Check if server is running
  if curl -s -o /dev/null -w "%{http_code}" "$TEST_BASE_URL/api/health" 2>/dev/null | grep -q "200"; then
    run_step "E2E: Admin journeys (Playwright)" \
      "npx playwright test e2e/admin-journeys.spec.ts" \
      "$FRONTEND_DIR"

    run_step "E2E: Portal journeys (Playwright)" \
      "npx playwright test e2e/portal-journeys.spec.ts" \
      "$FRONTEND_DIR"

    run_step "E2E: Tenant isolation (Playwright)" \
      "npx playwright test e2e/tenant-isolation.spec.ts" \
      "$FRONTEND_DIR"
  else
    skip_step "E2E tests" "Server not running at $TEST_BASE_URL (start with: npm run test:server)"
  fi
elif [ "$UNIT_ONLY" = false ]; then
  skip_step "E2E tests" "use --e2e flag to include"
fi

# ── Summary ──
echo ""
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Test Results                                              ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
for result in "${RESULTS[@]}"; do
  echo -e "  $result"
done
echo ""
echo -e "  ${GREEN}Passed: $PASSED${NC}  ${RED}Failed: $FAILED${NC}  ${YELLOW}Skipped: $SKIPPED${NC}"
echo ""

if [ $FAILED -gt 0 ]; then
  echo -e "${RED}Some tests failed!${NC}"
  exit 1
else
  echo -e "${GREEN}All tests passed!${NC}"
  exit 0
fi
