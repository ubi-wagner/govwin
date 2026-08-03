-- 146_solicitation_amendments.sql
-- Amendment fan-out engine (M3).
--
-- A detected amendment to a MASTER solicitation carries a compliance delta. Detection is advisory
-- (the platform-scope amendment_monitor agent, or an admin logging one manually). On admin
-- CONFIRMATION the amendment fans out to every proposal built from that solicitation as a
-- per-proposal flag the tenant must ACKNOWLEDGE — so a mid-flight requirement change never slips
-- past a customer. detected → confirmed → (per-proposal) acknowledged is the auditable state machine;
-- dismissed closes a false positive.

CREATE TABLE IF NOT EXISTS solicitation_amendments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id  UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,
    label            TEXT NOT NULL,                        -- e.g. "Amendment 0002"
    summary          TEXT NOT NULL,                        -- human-readable description of the change
    -- Structured delta: [{ change: 'added'|'removed'|'changed', requirement, detail }]
    compliance_delta JSONB NOT NULL DEFAULT '[]'::jsonb,
    severity         TEXT NOT NULL DEFAULT 'major' CHECK (severity IN ('critical', 'major', 'minor', 'info')),
    source           TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'amendment_monitor')),
    status           TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'confirmed', 'dismissed')),
    detected_by      UUID REFERENCES users(id),
    detected_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_by      UUID REFERENCES users(id),
    reviewed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_solicitation_amendments_sol ON solicitation_amendments(solicitation_id, status);

CREATE TABLE IF NOT EXISTS proposal_amendment_flags (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amendment_id     UUID NOT NULL REFERENCES solicitation_amendments(id) ON DELETE CASCADE,
    proposal_id      UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    acknowledged_by  UUID REFERENCES users(id),
    acknowledged_at  TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (amendment_id, proposal_id)
);
-- The banner query: unacknowledged flags for a proposal.
CREATE INDEX IF NOT EXISTS idx_proposal_amendment_flags_open
    ON proposal_amendment_flags(proposal_id) WHERE acknowledged_at IS NULL;
