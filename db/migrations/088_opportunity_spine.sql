-- Migration 088: the opportunity_id spine key + the cross-portal rollup (R0).
--
-- Additive only. Links automation runs to the opportunity for chaining + the
-- control tower; does NOT make any instance own status — status stays in the
-- domain (proposals.stage, curated_solicitations.status, tenant_pipeline_items
-- .pursuit_status), each its own single owner. No long-lived instances are
-- created here, so the WorkflowManager sweeps are unaffected. (Design:
-- docs/V1_REFACTOR_DESIGN.md, R0; corrected per the 3-factor review.)

ALTER TABLE process_instances
    ADD COLUMN IF NOT EXISTS opportunity_id UUID,
    ADD COLUMN IF NOT EXISTS scope          TEXT
        CHECK (scope IS NULL OR scope IN ('opp','spotlight','project','contract'));

CREATE INDEX IF NOT EXISTS idx_process_instances_opportunity
    ON process_instances (opportunity_id) WHERE opportunity_id IS NOT NULL;

-- Cross-portal project-status rollup (control-plane F3). Status is read from the
-- DOMAIN tables, keyed by the immutable opportunity_id. Deliberately NO
-- process_instances join: a single proposal spawns several automated reaction
-- instances, so joining them would fan out the counts (the 3-factor review's
-- flaw #5). The spine is the KEY, not a unified state machine.
CREATE OR REPLACE VIEW v_opportunity_rollup AS
SELECT
    o.id                               AS opportunity_id,
    o.title,
    o.agency,
    o.program_type,
    o.lifecycle_status,
    o.close_date,
    count(DISTINCT tpi.tenant_id)                                          AS ranked_tenants,
    count(DISTINCT tpi.tenant_id) FILTER (WHERE tpi.is_pinned)             AS pinned_tenants,
    count(DISTINCT p.id)                                                   AS proposals,
    count(DISTINCT p.id) FILTER (WHERE p.stage IN ('draft','review'))      AS proposals_in_build,
    count(DISTINCT p.id) FILTER (WHERE p.stage = 'final')                  AS proposals_final,
    count(DISTINCT p.id) FILTER (WHERE p.stage = 'submitted')              AS proposals_submitted,
    count(DISTINCT p.id) FILTER (WHERE p.stage = 'archived')               AS proposals_archived,
    max(p.updated_at)                                                      AS last_proposal_activity
FROM opportunities o
LEFT JOIN tenant_pipeline_items tpi ON tpi.opportunity_id = o.id
LEFT JOIN proposals            p   ON p.opportunity_id    = o.id
GROUP BY o.id, o.title, o.agency, o.program_type, o.lifecycle_status, o.close_date;
