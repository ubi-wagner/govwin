-- =============================================================================
-- Migration 034 — Grants.gov Data Source Registration
--
-- Adds pipeline schedule and source health for Grants.gov ingester.
-- Covers NIH, DOE, NSF, USDA, NASA, NIST, NOAA SBIR/STTR opportunities.
-- =============================================================================

-- Pipeline schedule: daily at 6 AM UTC
INSERT INTO pipeline_schedules (source, display_name, run_type, cron_expression, timezone, enabled, priority)
VALUES (
    'grants_gov',
    'Grants.gov SBIR/STTR NOFOs',
    'incremental',
    '0 6 * * *',
    'UTC',
    TRUE,
    20
)
ON CONFLICT (source) DO NOTHING;

-- Source health tracking
INSERT INTO source_health (source, display_name, status)
VALUES ('grants_gov', 'Grants.gov', 'unknown')
ON CONFLICT (source) DO NOTHING;
