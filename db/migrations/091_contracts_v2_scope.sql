-- Migration 091: V2 contract-execution scope (R6).
--
-- The spine's capstone: a WIN extends the SAME opportunity into contract execution.
-- contracts is keyed by the immutable opportunity_id (the spine) + the winning
-- proposal, and carries the proposal's origin_card forward so the card travels
-- V1 (proposal) → V2 (contract) unbroken. The generic ProjectCollaboration template
-- runs at scope='contract' over a contract (a kickoff gate, then execution gates) —
-- the same machine, one scope deeper, exactly as the refactor design intended.

CREATE TABLE IF NOT EXISTS contracts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- the spine key — the rollup/card join V1 and V2 by this.
    opportunity_id     UUID NOT NULL REFERENCES opportunities(id),
    -- the winning proposal this contract was awarded from (one contract per win).
    proposal_id        UUID REFERENCES proposals(id),
    title              TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'closed', 'terminated')),
    award_date         TIMESTAMPTZ DEFAULT now(),
    award_amount_cents BIGINT,
    pop_start          DATE,                          -- period of performance
    pop_end            DATE,
    -- the spine card, carried forward from the proposal (frozen origin lives on).
    origin_card        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One contract per winning proposal (idempotent win bridge).
CREATE UNIQUE INDEX IF NOT EXISTS uq_contracts_proposal
    ON contracts (proposal_id) WHERE proposal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_opportunity ON contracts (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_contracts_tenant ON contracts (tenant_id);

-- Extend the cross-portal rollup with the contract count — the V1→V2 arc, by the
-- same opportunity_id. All counts stay count(DISTINCT ...) so the extra LEFT JOIN
-- cannot fan out the existing numbers (the 3-factor review's flaw #5 stays closed).
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
    max(p.updated_at)                                                      AS last_proposal_activity,
    count(DISTINCT c.id)                                                   AS contracts
FROM opportunities o
LEFT JOIN tenant_pipeline_items tpi ON tpi.opportunity_id = o.id
LEFT JOIN proposals            p   ON p.opportunity_id    = o.id
LEFT JOIN contracts            c   ON c.opportunity_id    = o.id
GROUP BY o.id, o.title, o.agency, o.program_type, o.lifecycle_status, o.close_date;
