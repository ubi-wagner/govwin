-- 125_drop_dead_tables.sql
--
-- SCHEMA CLEANUP. Drops 12 tables that were superseded by the current spine and have
-- ZERO live code references anywhere (frontend + pipeline + CMS) — verified by a repo-wide
-- audit. Each has a documented successor; no unique data lives only in these tables.
-- (The library_units family + solicitation_topics were already dropped in migrations 121
-- and 030a/035 respectively; this is the remaining rot.)
--
-- Idempotent (DROP TABLE IF EXISTS ... CASCADE). CASCADE also removes the tables' own
-- indexes (e.g. idx_tpi_tenant_score / idx_tpi_tenant_pursuit on tenant_pipeline_items)
-- and any FK constraints pointing at them.
--
-- Table                        Superseded by
-- ---------------------------  ------------------------------------------------------
-- tenant_pipeline_items        tenant_opportunity_cards (the pin/score spine)
-- opportunity_events           system_events (deprecated in pipeline/src/events.py)
-- customer_events              system_events (deprecated)
-- content_events               system_events (deprecated)
-- pipeline_runs                pipeline_jobs
-- proposal_reviews             agent_task_queue + proposal_activity_log (color team)
-- solicitation_templates       solicitation_outlines / document_templates
-- tenant_uploads               tenant_documents / library_atoms
-- tenant_actions               triage_actions / tenant_bucket_scores
-- legal_document_versions      consent_records
-- system_config                platform_agent_config / system_events
-- collaborator_library_prefs   (retired collaborator-library-scope work; sibling of the
--                               library_unit_shares table dropped in mig 121)
--
-- NOT dropped here (intentionally kept): verification_tokens + invitations (auth/invite
-- surface), agent_archetypes (agent workforce), rate_limit_state (code names it as a
-- future target), system_health_snapshots (monitoring) — inert, low-risk, not rot.

-- v_opportunity_rollup (admin Opportunity Rollup, read by app/admin/opportunities) still
-- counted ranked/pinned tenants off tenant_pipeline_items — so it silently reported ZERO.
-- Drop it explicitly here (so the table drop doesn't CASCADE-surprise it) and recreate it
-- below on the live tenant_opportunity_cards spine.
DROP VIEW IF EXISTS v_opportunity_rollup;

DROP TABLE IF EXISTS tenant_pipeline_items      CASCADE;
DROP TABLE IF EXISTS opportunity_events         CASCADE;
DROP TABLE IF EXISTS customer_events            CASCADE;
DROP TABLE IF EXISTS content_events             CASCADE;
DROP TABLE IF EXISTS pipeline_runs              CASCADE;
DROP TABLE IF EXISTS proposal_reviews           CASCADE;
DROP TABLE IF EXISTS solicitation_templates     CASCADE;
DROP TABLE IF EXISTS tenant_uploads             CASCADE;
DROP TABLE IF EXISTS tenant_actions             CASCADE;
DROP TABLE IF EXISTS legal_document_versions    CASCADE;
DROP TABLE IF EXISTS system_config              CASCADE;
DROP TABLE IF EXISTS collaborator_library_prefs CASCADE;

-- Rebuild the rollup on the live spine: ranked/pinned counts now come from
-- tenant_opportunity_cards (excluding archived), fixing the zeros. Same column shape the
-- admin page selects (opportunity_id, title, agency, program_type, lifecycle_status,
-- close_date, ranked_tenants, pinned_tenants, proposals, proposals_in_build/_final/
-- _submitted/_archived, last_proposal_activity, contracts).
CREATE VIEW v_opportunity_rollup AS
SELECT
    o.id                                                              AS opportunity_id,
    o.title,
    o.agency,
    o.program_type,
    o.lifecycle_status,
    o.close_date,
    count(DISTINCT toc.tenant_id)                                     AS ranked_tenants,
    count(DISTINCT toc.tenant_id) FILTER (WHERE toc.is_pinned)        AS pinned_tenants,
    count(DISTINCT p.id)                                              AS proposals,
    count(DISTINCT p.id) FILTER (WHERE p.stage IN ('draft','review')) AS proposals_in_build,
    count(DISTINCT p.id) FILTER (WHERE p.stage = 'final')             AS proposals_final,
    count(DISTINCT p.id) FILTER (WHERE p.stage = 'submitted')         AS proposals_submitted,
    count(DISTINCT p.id) FILTER (WHERE p.stage = 'archived')          AS proposals_archived,
    max(p.updated_at)                                                 AS last_proposal_activity,
    count(DISTINCT c.id)                                              AS contracts
FROM opportunities o
LEFT JOIN tenant_opportunity_cards toc ON toc.opportunity_id = o.id AND toc.lifecycle_status <> 'archived'
LEFT JOIN proposals                p   ON p.opportunity_id    = o.id
LEFT JOIN contracts                c   ON c.opportunity_id    = o.id
GROUP BY o.id, o.title, o.agency, o.program_type, o.lifecycle_status, o.close_date;
