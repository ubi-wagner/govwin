#!/bin/bash
# ===========================================================================
# CRM Service — Database Migration Runner
# ---------------------------------------------------------------------------
# Runs all SQL migrations in order against CRM_DATABASE.
# Same pattern as the main db/migrations/run.sh.
#
# Usage:
#   ./run.sh                      # Run all pending migrations
#   ./run.sh --status             # Show applied migrations
#   ./run.sh --dry-run            # Show what would run
#
# Environment:
#   CRM_DATABASE       — Required. CRM PostgreSQL connection string.
#                        (CRM_DATABASE_URL and CMS_DATABASE_URL are honoured during
#                        the rename; the second is deprecated.)
#
# ⚠️ THE CRM DATABASE IS INTERNAL TO RAILWAY'S PRIVATE NETWORK. This script cannot be
#    run from GitHub Actions or a laptop against production — there is no public
#    endpoint to reach. Run it from inside the deployment (a Railway shell, or the
#    rfp-crm service's own release step). See docs/RAILWAY_ENV_VARS.md.
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# The same fallback chain as src/models/database.py's crm_database_url(), newest first. Bash
# cannot import the Python resolver, so the chain is repeated here — and
# `tests/test_crm_database_var.py` asserts the two agree, because a rename that updates one and
# not the other is exactly the failure this chain exists to prevent.
CONN="${CRM_DATABASE:-${CRM_DATABASE_URL:-${CMS_DATABASE_URL:-}}}"
if [ -z "$CONN" ]; then
  echo "CRM_DATABASE is not set (also looked for CRM_DATABASE_URL, CMS_DATABASE_URL)" >&2
  exit 1
fi
if [ -z "${CRM_DATABASE:-}" ] && [ -n "${CMS_DATABASE_URL:-}" ]; then
  echo "warning: CMS_DATABASE_URL is DEPRECATED — the CRM database variable is now CRM_DATABASE" >&2
fi

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Create tracking table if it doesn't exist
psql "$CONN" -q -c "
CREATE TABLE IF NOT EXISTS _cms_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
" 2>/dev/null

if [[ "${1:-}" == "--status" ]]; then
    echo -e "${YELLOW}Applied CRM migrations:${NC}"
    psql "$CONN" -t -c "SELECT filename, applied_at FROM _cms_migrations ORDER BY filename;"
    exit 0
fi

if [[ "${1:-}" == "--dry-run" ]]; then
    echo -e "${YELLOW}Pending CRM migrations (dry run):${NC}"
fi

APPLIED=0
SKIPPED=0

for f in "$SCRIPT_DIR"/[0-9]*.sql; do
    [ -f "$f" ] || continue
    BASENAME="$(basename "$f")"

    ALREADY=$(psql "$CONN" -t -c "SELECT 1 FROM _cms_migrations WHERE filename = '$BASENAME'" 2>/dev/null | tr -d ' ')
    if [[ "$ALREADY" == "1" ]]; then
        SKIPPED=$((SKIPPED + 1))
        continue
    fi

    if [[ "${1:-}" == "--dry-run" ]]; then
        echo -e "  ${YELLOW}PENDING${NC}: $BASENAME"
        continue
    fi

    echo -e "${GREEN}[migrate]${NC} Running $BASENAME..."
    if psql "$CONN" -v ON_ERROR_STOP=1 -f "$f"; then
        psql "$CONN" -q -c "INSERT INTO _cms_migrations (filename) VALUES ('$BASENAME');"
        echo -e "${GREEN}[migrate]${NC} $BASENAME ✓"
        APPLIED=$((APPLIED + 1))
    else
        echo -e "${RED}[migrate]${NC} $BASENAME FAILED"
        exit 1
    fi
done

echo -e "${GREEN}[migrate]${NC} CRM migrations complete: $APPLIED applied, $SKIPPED skipped"
