-- Migration 097: L3 execute layer — proposal portals (multi-proposal per opp),
-- scoped shadow-admin grants (replacing the unbounded god-view), and guardrail
-- templates with accept-at-launch. Greenfield, RLS-native.
--
-- A PORTAL binds a card (opportunity_id) to a proposal build; a card can have MANY
-- portals (labels), each owning its own guardrails/automation/status through
-- closeout. The card references its portals by the (tenant, opportunity) key.
-- A SHADOW-ADMIN GRANT is the per-portal, T&C-at-purchase, customer-revocable admin
-- access that replaces `verifyTenantAccess` returning true for admins on any tenant.

-- ── Portals (L3): one build per (tenant, opportunity, label) ──
CREATE TABLE IF NOT EXISTS proposal_portals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    opportunity_id   UUID NOT NULL,                       -- card link (soft ref, shard-safe)
    proposal_id      UUID REFERENCES proposals(id),        -- the build (existing proposal machinery)
    label            TEXT NOT NULL DEFAULT 'primary',      -- disambiguates multi-proposal (e.g. two techs)
    status           TEXT NOT NULL DEFAULT 'guardrails_pending'
        CHECK (status IN ('guardrails_pending','launched','executing','closeout','archived','abandoned')),
    guardrail_config JSONB NOT NULL DEFAULT '{}'::jsonb,   -- frozen at accept-launch
    launched_at      TIMESTAMPTZ,
    created_by       UUID REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, opportunity_id, label)
);
CREATE INDEX IF NOT EXISTS idx_pp_tenant_opp ON proposal_portals (tenant_id, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_pp_proposal   ON proposal_portals (proposal_id) WHERE proposal_id IS NOT NULL;
DROP TRIGGER IF EXISTS pp_updated ON proposal_portals;
CREATE TRIGGER pp_updated BEFORE UPDATE ON proposal_portals FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE proposal_portals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_portals FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON proposal_portals;
CREATE POLICY tenant_isolation ON proposal_portals
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON proposal_portals TO govtech_app;

-- ── Shadow-admin grants: scoped, per-portal, T&C-at-purchase, customer-revocable ──
CREATE TABLE IF NOT EXISTS shadow_admin_grants (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES tenants(id),
    portal_id      UUID NOT NULL REFERENCES proposal_portals(id) ON DELETE CASCADE,
    admin_user_id  UUID REFERENCES users(id),             -- the RFP/support admin (NULL = role-based grant)
    admin_email    TEXT,
    source         TEXT NOT NULL CHECK (source IN ('t_and_c','invite')),
    active         BOOLEAN NOT NULL DEFAULT true,
    granted_by     UUID REFERENCES users(id),
    granted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_by     UUID REFERENCES users(id),
    revoked_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_sag_portal ON shadow_admin_grants (portal_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_sag_admin  ON shadow_admin_grants (admin_user_id) WHERE active;

ALTER TABLE shadow_admin_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow_admin_grants FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shadow_admin_grants;
CREATE POLICY tenant_isolation ON shadow_admin_grants
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON shadow_admin_grants TO govtech_app;

-- ── Guardrail templates: a customer bundle (stages + gate reqs + collaborators +
-- automation + agent-assistance) applied at accept-launch. tenant_id NULL = a global
-- default template every tenant can read + clone. ──
CREATE TABLE IF NOT EXISTS guardrail_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID REFERENCES tenants(id),              -- NULL = global default
    name        TEXT NOT NULL,
    description TEXT,
    config      JSONB NOT NULL DEFAULT '{}'::jsonb,       -- { stages[], gateRequirements[], collaborators[], automation{}, agentAssistance{}, documentSettings{} }
    is_default  BOOLEAN NOT NULL DEFAULT false,
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gt_tenant ON guardrail_templates (tenant_id);
DROP TRIGGER IF EXISTS gt_updated ON guardrail_templates;
CREATE TRIGGER gt_updated BEFORE UPDATE ON guardrail_templates FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE guardrail_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrail_templates FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON guardrail_templates;
CREATE POLICY tenant_isolation ON guardrail_templates
    USING      (tenant_id IS NULL OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON guardrail_templates TO govtech_app;
