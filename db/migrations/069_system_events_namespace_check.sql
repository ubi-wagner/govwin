-- 069_system_events_namespace_check.sql
--
-- DATA-03: Add CHECK constraint on system_events.namespace enforcing the 7 canonical
-- namespaces and excluding the dead 'agent' namespace.
--
-- Background: Migration 007 created system_events with namespace TEXT NOT NULL but
-- without a CHECK constraint — the 7-namespace set (including 'agent') was documented
-- in code comments only. ARCHITECTURE_V9 §8.2 and CLAUDE.md confirm zero runtime
-- emissions of the 'agent' namespace; all agent invocation events are emitted under
-- 'tool' (tool.invoke.start / tool.invoke.end). This migration formalises the
-- canonical 7-namespace set at the DB level and removes 'agent' as a valid value.
--
-- Canonical namespaces (CLAUDE.md / ARCHITECTURE_V9 §8.2):
--   finder    — opportunity ingestion, triage, curation, push
--   capture   — customer conversion, purchases, workspace provision
--   identity  — auth, invites, password changes
--   proposal  — workspace lifecycle
--   library   — content library operations
--   system    — platform operations (migrations, deploys, errors)
--   tool      — tool invocation audit
--
-- No existing CHECK constraint on this column exists in the schema; this ADD is a
-- fresh constraint, not a drop-and-re-add. Constraint name: system_events_namespace_chk
--
-- NOT VALID: the constraint is added WITHOUT scanning pre-existing rows, so any
-- historical/dev row with a non-canonical namespace cannot block the migration at
-- ADD-CONSTRAINT time (which would fail the whole deploy). It is still enforced on
-- every NEW insert/update. Belt-and-suspenders: the admin POST /api/events route
-- validates namespace against this same allowlist (returns 422), so a caller gets
-- a clean error instead of a raw CHECK violation.
--
-- Source: ARCHITECTURE_V9 §8.2 / BASELINE_FINDINGS §6.2 / LAUNCH_TODO DATA-03

ALTER TABLE system_events
  DROP CONSTRAINT IF EXISTS system_events_namespace_chk;

ALTER TABLE system_events
  ADD CONSTRAINT system_events_namespace_chk
  CHECK (namespace IN ('finder','capture','identity','proposal','library','system','tool'))
  NOT VALID;
