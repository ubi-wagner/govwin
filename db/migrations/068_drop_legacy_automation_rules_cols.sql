-- 068_drop_legacy_automation_rules_cols.sql
--
-- DATA-01: Drop legacy trigger_bus and trigger_events columns from automation_rules.
--
-- Background: automation_rules originally used trigger_bus (TEXT, one of the three
-- legacy event-bus table names) and trigger_events (TEXT[]) to identify which events
-- should fire a rule. Migration 019 introduced trigger_namespace + trigger_type as
-- the canonical replacement aligned with the system_events stream. All seeded rules
-- (migrations 019, 028, 040, 050) were written using the new columns.
--
-- Safety confirmation (grep -rn "trigger_bus|trigger_events" pipeline/ services/ frontend/):
--   services/cms/src/event_listener.py:  Runtime introspects col_names at query time.
--     Variant 2 (trigger_bus + trigger_events) is reached only via `elif` — i.e. ONLY
--     when trigger_namespace/trigger_type are absent. Since those columns exist in the
--     live schema, variant 1 always takes precedence; variant 2 is dead code for this DB.
--   services/cms/tests/test_rule_matching_phase.py:  Unit tests for the now-unreachable
--     variant 2 branch — test-only, no production writes.
-- No pipeline/ or frontend/ references found. Drop is safe.
--
-- Source: ARCHITECTURE_V9 §7.5 / DEPRECATION_CANDIDATES §B / LAUNCH_TODO DATA-01

ALTER TABLE automation_rules DROP COLUMN IF EXISTS trigger_bus;
ALTER TABLE automation_rules DROP COLUMN IF EXISTS trigger_events;
