-- 138_drop_retired_tables.sql
-- Rebaseline cleanup (task #143): drop 3 retired tables that each have a LIVE SUCCESSOR
-- and ZERO live code references.
--
-- Drop-safety verified this cycle:
--   • No inbound FK constraints reference any of the three (nothing to cascade/block).
--   • 0 SQL-context references (FROM/INTO/UPDATE/JOIN/DELETE) across frontend, pipeline, CMS.
--   • The only test that NAMES them (pipeline/tests/test_scoring.py) is a static source-string
--     assertion (it forbids `FROM/INTO/UPDATE <table>` in the scorer's source) — unaffected by
--     dropping the DB objects. `tenant_pipeline_items` (dropped in mig 125) is in that same list
--     and the test passes, proving tolerance of absence.
--   • Dropping each auto-removes its RLS-enable + tenant_isolation policy (they were in the
--     RLS "ISOLATE" set, not the force-RLS 19).
--
-- HELD (intentionally NOT dropped) per the "superseded-with-a-successor" SOP:
--   • accounts / sessions / verification_tokens — NextAuth adapter tables, unused under the
--     JWT+credentials model but conventional scaffolding (no successor; re-add risk if auth
--     config ever changes).
--   • system_health_snapshots — unwired observability table with NO successor.

DROP TABLE IF EXISTS invitations;              -- superseded: invite flow rebuilt on proposal_collaborators + user_memberships
DROP TABLE IF EXISTS spotlight_bucket_scores;  -- retired legacy Spotlight scoring → tenant_bucket_scores (canonical card-spine scoring)
DROP TABLE IF EXISTS spotlights;               -- retired legacy Spotlight surface → tenant_spotlight_buckets
