-- 142_drop_superseded_tables.sql
-- Post-audit cleanup: drop the dead tables that satisfy BOTH halves of the CLAUDE.md drop-SOP
-- ("drop ONLY when superseded-with-a-successor AND zero live code refs"). Three qualify.
--
-- Drop-safety verified this cycle (pre-drop checks, 2026-08-01):
--   • 0 SQL-context references (FROM/INTO/UPDATE/JOIN/DELETE) across frontend, pipeline, CMS.
--   • No inbound FK constraints reference any of the three (nothing to cascade/block).
--   • Each has a LIVE SUCCESSOR that fully owns the concern (below).
--
--   1. tenant_automation_preferences → SUPERSEDED BY tenant_automation_policies (mig 127).
--      The last two readers (proposal-advance.ts ai_review_on_advance, lock-section.ts
--      auto_advance_when_all_locked) were repointed to the live policies table THIS change,
--      so it now has zero readers and (always had) zero writers.
--   2. audit_log → SUPERSEDED BY system_events (the live, immutable audit trail used everywhere).
--      Its only writer, lib/db.ts auditLog(), had zero callers (dead export).
--   3. agent_archetypes → SUPERSEDED BY the pipeline archetype code registry
--      (auto-registered from pipeline/src/agents/archetypes/*.py). The DB table was a
--      migration-seeded mirror (004_seed_agents.sql) the app never reads.
--
-- DELIBERATELY KEPT (no successor → SOP forbids dropping on "empty" alone; several were
-- explicitly held by mig 138): accounts / sessions / verification_tokens (NextAuth adapter
-- scaffolding), system_health_snapshots (unwired, no successor), rate_limit_state (documented
-- future multi-container store; the live limiter is in-memory), scout_runs (unwired crawl infra).
--
-- Dropping each auto-removes its RLS-enable + tenant_isolation policy if present (none of the
-- three are in the force-RLS 19 set).

DROP TABLE IF EXISTS tenant_automation_preferences;  -- → tenant_automation_policies (mig 127)
DROP TABLE IF EXISTS audit_log;                       -- → system_events (live audit trail)
DROP TABLE IF EXISTS agent_archetypes;                -- → pipeline archetype code registry
