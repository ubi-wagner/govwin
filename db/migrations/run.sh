#!/bin/bash
# ===========================================================================
# GovWin — Database Migration & Seed Runner
# ---------------------------------------------------------------------------
# Runs all SQL migrations in order, tracks which have been applied,
# and optionally seeds the admin account.
#
# Usage:
#   ./run.sh                      # Run all pending migrations
#   ./run.sh --seed               # Run migrations + seed admin
#   ./run.sh --status             # Show which migrations have been applied
#   ./run.sh --reset              # Drop tracking table and re-run all (dangerous)
#   ./run.sh --dry-run            # Show what would run without running it
#
# Environment:
#   DATABASE_URL   — Required. PostgreSQL connection string.
#
# Railway:
#   railway run --service govtech-frontend bash db/migrations/run.sh
#   railway run --service govtech-frontend bash db/migrations/run.sh --seed
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONN="${DATABASE_URL:?DATABASE_URL is not set. Export it or use: railway run --service govtech-frontend bash db/migrations/run.sh}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

SEED=false
STATUS_ONLY=false
RESET=false
DRY_RUN=false

for arg in "$@"; do
  case $arg in
    --seed)      SEED=true ;;
    --status)    STATUS_ONLY=true ;;
    --reset)     RESET=true ;;
    --dry-run)   DRY_RUN=true ;;
    --help|-h)
      head -20 "$0" | tail -18
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown flag: $arg${NC}"
      echo "Usage: ./run.sh [--seed] [--status] [--reset] [--dry-run]"
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Ensure tracking table exists
# ---------------------------------------------------------------------------
ensure_tracking_table() {
  psql "$CONN" -q -X <<'SQL'
    CREATE TABLE IF NOT EXISTS _migration_history (
      filename    TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      checksum    TEXT
    );
SQL
}

# ---------------------------------------------------------------------------
# Check if a migration has already been applied
# ---------------------------------------------------------------------------
is_applied() {
  local file="$1"
  local count
  count=$(psql "$CONN" -tAX -c "SELECT COUNT(*) FROM _migration_history WHERE filename = '$file';")
  [ "$count" -gt 0 ]
}

# ---------------------------------------------------------------------------
# Mark a migration as applied
# ---------------------------------------------------------------------------
mark_applied() {
  local file="$1"
  local checksum="$2"
  psql "$CONN" -q -X -c "INSERT INTO _migration_history (filename, checksum) VALUES ('$file', '$checksum') ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = '$checksum';"
}

# ---------------------------------------------------------------------------
# Status: show what's applied
# ---------------------------------------------------------------------------
if $STATUS_ONLY; then
  ensure_tracking_table
  echo -e "${CYAN}Migration Status${NC}"
  echo "-------------------------------------------"
  for migration in "$SCRIPT_DIR"/0*.sql; do
    file=$(basename "$migration")
    if is_applied "$file"; then
      echo -e "  ${GREEN}applied${NC}  $file"
    else
      echo -e "  ${YELLOW}pending${NC}  $file"
    fi
  done
  echo ""
  echo -e "Applied at times:"
  psql "$CONN" -X -c "SELECT filename, applied_at FROM _migration_history ORDER BY filename;"
  exit 0
fi

# ---------------------------------------------------------------------------
# Reset: drop tracking (migrations stay, but will re-run)
# ---------------------------------------------------------------------------
if $RESET; then
  echo -e "${RED}WARNING: This drops the migration tracking table.${NC}"
  echo -e "${RED}All migrations will re-run on next invocation.${NC}"
  echo -e "${RED}The migrations themselves use IF NOT EXISTS / ON CONFLICT${NC}"
  echo -e "${RED}so this is generally safe, but review before confirming.${NC}"
  read -rp "Type 'reset' to confirm: " confirm
  if [ "$confirm" != "reset" ]; then
    echo "Aborted."
    exit 1
  fi
  psql "$CONN" -q -X -c "DROP TABLE IF EXISTS _migration_history;"
  echo -e "${GREEN}Tracking table dropped.${NC}"
  exit 0
fi

# ---------------------------------------------------------------------------
# Run pending migrations
# ---------------------------------------------------------------------------
ensure_tracking_table

echo ""
echo -e "${CYAN}GovWin — Database Migrations${NC}"
echo "==========================================="
echo ""

applied=0
skipped=0
failed=0

for migration in "$SCRIPT_DIR"/0*.sql; do
  file=$(basename "$migration")
  checksum=$(sha256sum "$migration" | cut -d' ' -f1)

  if is_applied "$file"; then
    skipped=$((skipped + 1))
    if ! $DRY_RUN; then
      echo -e "  ${GREEN}skip${NC}  $file (already applied)"
    else
      echo -e "  ${GREEN}skip${NC}  $file"
    fi
    continue
  fi

  if $DRY_RUN; then
    echo -e "  ${YELLOW}would run${NC}  $file"
    applied=$((applied + 1))
    continue
  fi

  echo -ne "  ${YELLOW}running${NC}  $file ... "

  if psql "$CONN" -f "$migration" --single-transaction -q -X 2>/tmp/govwin_migration_err; then
    mark_applied "$file" "$checksum"
    echo -e "${GREEN}done${NC}"
    applied=$((applied + 1))
  else
    echo -e "${RED}FAILED${NC}"
    echo ""
    echo -e "${RED}Error output:${NC}"
    cat /tmp/govwin_migration_err
    echo ""
    echo -e "${RED}Migration stopped at $file. Fix the issue and re-run.${NC}"
    echo -e "Hint: $applied migrations applied before this failure."
    failed=1
    break
  fi
done

echo ""
echo "==========================================="
if $DRY_RUN; then
  echo -e "${CYAN}Dry run:${NC} $applied would run, $skipped already applied"
else
  echo -e "Applied: ${GREEN}$applied${NC}  Skipped: $skipped  Failed: $failed"
fi

if [ "$failed" -gt 0 ]; then
  exit 1
fi

# ---------------------------------------------------------------------------
# Seed admin account (optional)
# ---------------------------------------------------------------------------
if $SEED; then
  echo ""
  echo -e "${CYAN}Seeding admin account...${NC}"
  echo ""

  if [ -f "$REPO_ROOT/frontend/node_modules/.bin/tsx" ]; then
    cd "$REPO_ROOT/frontend" && npx tsx "$REPO_ROOT/scripts/seed_admin.ts"
  elif command -v npx &>/dev/null; then
    cd "$REPO_ROOT/frontend" && npx tsx "$REPO_ROOT/scripts/seed_admin.ts"
  else
    echo -e "${RED}npx not found. Run manually:${NC}"
    echo "  cd frontend && npx tsx ../scripts/seed_admin.ts"
    exit 1
  fi
fi

echo ""
echo -e "${GREEN}Done.${NC}"
