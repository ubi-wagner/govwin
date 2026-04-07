-- ============================================================================
-- DROP ALL — Wipes the entire public schema before baseline runs
-- This is a clean-build migration. Run on every deploy until V1 launches.
-- After launch, this should be removed or gated to prevent data loss.
-- ============================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO PUBLIC;
