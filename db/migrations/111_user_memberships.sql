-- Migration 111: user_memberships — multi-membership identity (P1 foundation).
--
-- Identity (users.email) is the global person; a person may act as MANY
-- (company, role) memberships — a customer at their own company, an employee of
-- ours, and a scoped collaborator at other companies. See
-- docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
--
-- P1 is the COMPATIBLE substrate: create the junction and backfill one "home"
-- membership per existing user from users.(tenant_id, role). With exactly one
-- membership each, authorization behaves identically to today — verifyTenantAccess
-- reads memberships (with a users read-through fallback during transition).
--
-- INVARIANT (design): a SESSION authorizes exactly one membership at a time
-- (singular). This table only enumerates the CHOICES; the session pins one.
-- Non-employees cannot switch in-session; only RFP-admins descend/ascend (audited).

CREATE TABLE IF NOT EXISTS user_memberships (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- ALWAYS a real company (incl. our own org, once it exists as a tenant).
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    role       TEXT NOT NULL
                 CHECK (role IN ('master_admin','rfp_admin','tenant_admin','tenant_user','partner_user')),
    status     TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','invited','revoked')),
    -- Where the membership came from — the projection source (unifies the three
    -- existing grant mechanisms; see the design doc's reconciliation section).
    source     TEXT NOT NULL DEFAULT 'home'
                 CHECK (source IN ('home','shadow_t_and_c','collaborator','manual')),
    scope      JSONB NOT NULL DEFAULT '{}'::jsonb,   -- e.g. per-section grants ref
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES users(id),
    -- At most one membership per (person, company). Role lives on the membership.
    UNIQUE (user_id, tenant_id)
);

-- The login/selector query: "my active memberships".
CREATE INDEX IF NOT EXISTS idx_user_memberships_user
    ON user_memberships (user_id, status);
-- The "who can act in this tenant" query (route authz).
CREATE INDEX IF NOT EXISTS idx_user_memberships_tenant
    ON user_memberships (tenant_id, status);

-- ── Backfill: one HOME membership per existing user that has a company ──────────
-- Admins (users.tenant_id IS NULL) get NO home row here: their access to customer
-- tenants is the DERIVED shadow membership (tenant_admin in every tenant, by T&C),
-- resolved at authz time, not materialized. Tenant + partner users get their home
-- membership, mirroring today's users.(tenant_id, role).
INSERT INTO user_memberships (user_id, tenant_id, role, status, source)
SELECT id, tenant_id, role,
       CASE WHEN is_active THEN 'active' ELSE 'revoked' END,
       'home'
FROM users
WHERE tenant_id IS NOT NULL
ON CONFLICT (user_id, tenant_id) DO NOTHING;
