-- ============================================================================
-- Migration 093: Collaborator library scope (D6 — Option B)
--
-- Additive + side-effect-free: existing rows default to visibility='tenant'
-- (today's behavior — visible to the whole tenant). Implements the
-- per-collaborator ownership + per-proposal sharing model from
-- docs/END_TO_END_SPEC_AND_PLAN_2026-06-30.md §5:
--   • library_units.owner_user_id : the uploader (NULL = tenant/admin-owned)
--   • library_units.visibility    : owner_only | shared_for_proposal | tenant
--   • library_unit_shares         : per-proposal approval (collaborator → customer)
--   • collaborator_library_prefs  : sharing posture per (collaborator, customer)
--
-- NOTE: the platform/global "RFP-Pipeline library" scope (a reserved tenant) is a
-- SEPARATE change — it needs customer-flow exclusion logic (spotlight push, tenant
-- lists, billing) and is intentionally NOT in this migration.
-- ============================================================================

ALTER TABLE library_units
    ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS visibility    TEXT NOT NULL DEFAULT 'tenant'
        CHECK (visibility IN ('tenant', 'owner_only', 'shared_for_proposal'));

CREATE INDEX IF NOT EXISTS idx_library_units_owner
    ON library_units(owner_user_id) WHERE owner_user_id IS NOT NULL;

-- Per-proposal share grants: a collaborator approves one of their atoms for use
-- on a specific proposal. Forward-looking — a later restrict/delete does NOT
-- retract a grant already consumed into a locked proposal artifact (that is the
-- customer's proposal). UNIQUE keeps it idempotent per (unit, proposal).
CREATE TABLE IF NOT EXISTS library_unit_shares (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id     UUID NOT NULL REFERENCES library_units(id) ON DELETE CASCADE,
    proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    approved_by UUID REFERENCES users(id),
    approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (unit_id, proposal_id)
);
CREATE INDEX IF NOT EXISTS idx_lus_proposal ON library_unit_shares(proposal_id);
CREATE INDEX IF NOT EXISTS idx_lus_unit     ON library_unit_shares(unit_id);

-- Sharing posture per (collaborator, customer). Default = restrict (safe);
-- a collaborator may switch to share_all ("shareable until restricted").
CREATE TABLE IF NOT EXISTS collaborator_library_prefs (
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    share_default TEXT NOT NULL DEFAULT 'restrict_until_approved'
        CHECK (share_default IN ('share_all', 'restrict_until_approved')),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (owner_user_id, tenant_id)
);
