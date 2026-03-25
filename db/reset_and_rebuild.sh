#!/bin/bash
# ===========================================================================
# GovWin — Nuclear Reset: Drop Everything & Rebuild from Baseline
# ---------------------------------------------------------------------------
# Drops ALL tables, views, functions, and types, then runs the baseline
# migration (000_baseline.sql) to recreate everything from scratch.
#
# Usage:
#   DATABASE_URL=postgresql://... bash db/reset_and_rebuild.sh
#
# Or via Railway Query tab — copy/paste the DROP section manually.
#
# WARNING: This is DESTRUCTIVE. All data will be lost.
# ===========================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONN="${DATABASE_URL:?DATABASE_URL is not set}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${RED}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║  WARNING: This will DROP ALL TABLES AND DATA    ║${NC}"
echo -e "${RED}║  and rebuild the database from 000_baseline.sql ║${NC}"
echo -e "${RED}╚══════════════════════════════════════════════════╝${NC}"
echo ""

if [ "${FORCE:-}" != "true" ]; then
  read -rp "Type 'NUKE' to confirm: " confirm
  if [ "$confirm" != "NUKE" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo ""
echo -e "${YELLOW}Dropping everything...${NC}"

psql "$CONN" -q -X <<'SQL'
-- Drop all views first (they depend on tables)
DROP VIEW IF EXISTS focus_area_content CASCADE;
DROP VIEW IF EXISTS tenant_content_summary CASCADE;
DROP VIEW IF EXISTS tenant_active_opps CASCADE;
DROP VIEW IF EXISTS tenant_analytics CASCADE;
DROP VIEW IF EXISTS opportunity_tenant_coverage CASCADE;
DROP VIEW IF EXISTS tenant_pipeline CASCADE;
DROP VIEW IF EXISTS tenant_opportunity_reactions CASCADE;
DROP VIEW IF EXISTS api_key_status CASCADE;

-- Drop all functions
DROP FUNCTION IF EXISTS get_system_status() CASCADE;
DROP FUNCTION IF EXISTS get_remaining_quota(TEXT) CASCADE;
DROP FUNCTION IF EXISTS dequeue_job(TEXT) CASCADE;
DROP FUNCTION IF EXISTS notify_pipeline_worker() CASCADE;
DROP FUNCTION IF EXISTS notify_opportunity_event() CASCADE;
DROP FUNCTION IF EXISTS notify_customer_event() CASCADE;
DROP FUNCTION IF EXISTS notify_content_event() CASCADE;
DROP FUNCTION IF EXISTS mark_events_processed(TEXT, UUID[], TEXT) CASCADE;
DROP FUNCTION IF EXISTS dequeue_opportunity_events(TEXT[], TEXT, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS dequeue_customer_events(TEXT[], TEXT, INTEGER) CASCADE;
DROP FUNCTION IF EXISTS get_iso_week_label(TIMESTAMPTZ) CASCADE;
DROP FUNCTION IF EXISTS check_opp_cap(UUID) CASCADE;
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;

-- Drop junction tables
DROP TABLE IF EXISTS boilerplate_focus_areas CASCADE;
DROP TABLE IF EXISTS partner_focus_areas CASCADE;
DROP TABLE IF EXISTS personnel_focus_areas CASCADE;
DROP TABLE IF EXISTS capability_focus_areas CASCADE;
DROP TABLE IF EXISTS past_performance_focus_areas CASCADE;

-- Drop consent/legal
DROP TABLE IF EXISTS consent_records CASCADE;
DROP TABLE IF EXISTS legal_document_versions CASCADE;

-- Drop automation
DROP TABLE IF EXISTS automation_log CASCADE;
DROP TABLE IF EXISTS automation_rules CASCADE;

-- Drop event tables
DROP TABLE IF EXISTS content_events CASCADE;
DROP TABLE IF EXISTS customer_events CASCADE;
DROP TABLE IF EXISTS opportunity_events CASCADE;

-- Drop CMS
DROP TABLE IF EXISTS site_content CASCADE;

-- Drop content library
DROP TABLE IF EXISTS focus_areas CASCADE;
DROP TABLE IF EXISTS teaming_partners CASCADE;

-- Drop knowledge base
DROP TABLE IF EXISTS boilerplate_sections CASCADE;
DROP TABLE IF EXISTS key_personnel CASCADE;
DROP TABLE IF EXISTS capabilities CASCADE;
DROP TABLE IF EXISTS past_performance CASCADE;

-- Drop files/storage
DROP TABLE IF EXISTS stored_files CASCADE;
DROP TABLE IF EXISTS integration_executions CASCADE;
DROP TABLE IF EXISTS email_log CASCADE;

-- Drop opportunity tables
DROP TABLE IF EXISTS amendments CASCADE;
DROP TABLE IF EXISTS documents CASCADE;
DROP TABLE IF EXISTS tenant_actions CASCADE;
DROP TABLE IF EXISTS tenant_opportunities CASCADE;
DROP TABLE IF EXISTS opportunities CASCADE;

-- Drop pipeline/control
DROP TABLE IF EXISTS notifications_queue CASCADE;
DROP TABLE IF EXISTS source_health CASCADE;
DROP TABLE IF EXISTS pipeline_runs CASCADE;
DROP TABLE IF EXISTS pipeline_jobs CASCADE;
DROP TABLE IF EXISTS rate_limit_state CASCADE;
DROP TABLE IF EXISTS pipeline_schedules CASCADE;
DROP TABLE IF EXISTS api_key_registry CASCADE;
DROP TABLE IF EXISTS system_config CASCADE;

-- Drop tenant tables
DROP TABLE IF EXISTS tenant_uploads CASCADE;
DROP TABLE IF EXISTS download_links CASCADE;
DROP TABLE IF EXISTS tenant_profiles CASCADE;
DROP TABLE IF EXISTS audit_log CASCADE;

-- Drop auth tables
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS verification_tokens CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

-- Drop migration tracking
DROP TABLE IF EXISTS _migration_history CASCADE;
SQL

echo -e "${GREEN}All tables dropped.${NC}"
echo ""
echo -e "${CYAN}Running baseline migration...${NC}"

# Run the baseline
psql "$CONN" -f "$SCRIPT_DIR/migrations/000_baseline.sql" --single-transaction -q -X

echo -e "${GREEN}Baseline migration applied.${NC}"

# Create migration history and mark baseline as applied
psql "$CONN" -q -X <<SQL
CREATE TABLE IF NOT EXISTS _migration_history (
    filename    TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    checksum    TEXT
);

-- Mark baseline and all original migrations as applied
-- so the incremental runner doesn't try to re-apply them
INSERT INTO _migration_history (filename, checksum) VALUES
    ('000_baseline.sql', '$(sha256sum "$SCRIPT_DIR/migrations/000_baseline.sql" | cut -d' ' -f1)'),
    ('001_auth_tenants.sql', 'consolidated_into_000'),
    ('002_control_plane.sql', 'consolidated_into_000'),
    ('003_opportunities.sql', 'consolidated_into_000'),
    ('004_knowledge_base.sql', 'consolidated_into_000'),
    ('005_seed_test_data.sql', 'consolidated_into_000'),
    ('006_drive_files.sql', 'consolidated_into_000'),
    ('007_event_bus_and_drive_architecture.sql', 'consolidated_into_000'),
    ('008_api_key_encryption.sql', 'consolidated_into_000'),
    ('009_local_storage.sql', 'consolidated_into_000'),
    ('010_opportunity_full_metadata.sql', 'consolidated_into_000'),
    ('011_reminder_nudges_schedule.sql', 'consolidated_into_000'),
    ('012_site_content.sql', 'consolidated_into_000'),
    ('013_content_library.sql', 'consolidated_into_000'),
    ('014_seed_cms_drafts.sql', 'consolidated_into_000'),
    ('015_reseed_cms_home_getstarted.sql', 'consolidated_into_000'),
    ('016_event_enhancements.sql', 'consolidated_into_000'),
    ('017_automation_framework.sql', 'consolidated_into_000'),
    ('018_status_reporting_enhancements.sql', 'consolidated_into_000'),
    ('019_consent_tracking.sql', 'consolidated_into_000'),
    ('020_fix_system_status_ambiguous_column.sql', 'consolidated_into_000'),
    ('021_fix_content_events_processing.sql', 'consolidated_into_000'),
    ('022_clean_reseed_production.sql', 'consolidated_into_000')
ON CONFLICT (filename) DO UPDATE SET applied_at = NOW(), checksum = EXCLUDED.checksum;
SQL

echo -e "${GREEN}Migration history seeded — all 001-022 marked as consolidated.${NC}"
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Database rebuilt from baseline.                 ║${NC}"
echo -e "${GREEN}║  Master admin: eric@rfppipeline.com              ║${NC}"
echo -e "${GREEN}║  Password: TestPass123!                          ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
