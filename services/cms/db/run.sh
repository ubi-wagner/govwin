#!/bin/bash
# ===========================================================================
# CRM Service — Database Migration Runner
# ---------------------------------------------------------------------------
# Runs all SQL migrations in order against CMS_DATABASE_URL.
# Same pattern as the main db/migrations/run.sh.
#
# Usage:
#   ./run.sh                      # Run all pending migrations
#   ./run.sh --status             # Show applied migrations
#   ./run.sh --dry-run            # Show what would run
#
# Environment:
#   CMS_DATABASE_URL   — Required. CRM PostgreSQL connection string.
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONN="${CMS_DATABASE_URL:?CMS_DATABASE_URL is not set}"

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
