-- ============================================================================
-- DROP ALL — Wipes the entire public schema before baseline runs
-- This is a clean-build migration. Runs ONLY when ALLOW_SCHEMA_RESET=true
-- (db/migrations/migrate.mjs skips it otherwise).
-- After launch, this should be removed or gated to prevent data loss.
-- ============================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO PUBLIC;

-- The DROP above also drops migrate.mjs's tracking table (it lives in public).
-- Recreate it in THIS migration so the runner can record this file in the same
-- transaction — otherwise the post-run INSERT hits "relation _migration_history
-- does not exist" and the whole reset rolls back. Must match the runner's DDL.
CREATE TABLE IF NOT EXISTS _migration_history (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum    TEXT
);
