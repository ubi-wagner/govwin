-- Migration 127: tenant_automation_policies — the TENANT level of the three-level
-- automation-policy model (docs/AUTOMATION_POLICY_DESIGN.md §3 + §12).
--
-- One row per (tenant, scope, trigger_key). The four grammar dimensions
-- (recipients × trigger × timing × escalation) as typed columns + small JSONB.
-- The resolver (Phase B) merges this OVER the platform framework (mig 126) and
-- UNDER any portal config / explicit launch override.
--
-- Ships INERT: no rows are seeded (an un-configured tenant rides the framework
-- default), and nothing reads this table until the resolver lands. RLS is FORCEd
-- with the same tenant_isolation pattern as proposal_portals (mig 097), so it is
-- correct under the future NOBYPASSRLS `govtech_app` cutover.

CREATE TABLE IF NOT EXISTS tenant_automation_policies (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    scope            TEXT NOT NULL CHECK (scope IN ('discovery','build')),
    trigger_key      TEXT NOT NULL,               -- 'namespace:type' (matches the system_events river)
    enabled          BOOLEAN NOT NULL DEFAULT true,

    -- recipients (who) — resolved to user_ids at fire time; the admin floor is separate + non-removable
    recipient_roles  TEXT[]  NOT NULL DEFAULT '{}',    -- e.g. {tenant_admin,tenant_user}
    recipient_users  UUID[]  NOT NULL DEFAULT '{}',    -- explicit user ids
    recipient_flags  TEXT[]  NOT NULL DEFAULT '{}',    -- {delegated_managers,collaborators_at_stage}

    -- trigger refinement (which) — a conditionsMatch() predicate over the event payload
    condition        JSONB   NOT NULL DEFAULT '{}'::jsonb,

    -- timing (when): an absolute window OR a relative anchor (close_date is guaranteed present, mig 128 / ⑤)
    due_in_minutes           INTEGER,
    relative_anchor          TEXT CHECK (relative_anchor IN ('open_date','close_date','stage_entered')),
    relative_offset_minutes  INTEGER,                  -- signed; -20160 = 2 weeks before the anchor

    -- escalation (how): the relative nudge cadence; the last beat adds the admin floor (managers + RFP backstop)
    nudge_days       INTEGER[] NOT NULL DEFAULT '{1,3}',

    -- delivery
    channel          TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email','todo','both')),

    -- concurrency guards (mirror automation_rules so policy notifies can't spam)
    cooldown_minutes    INTEGER NOT NULL DEFAULT 0,
    max_fires_per_hour  INTEGER NOT NULL DEFAULT 0,

    configured_at    TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, scope, trigger_key)
);

CREATE INDEX IF NOT EXISTS idx_tap_tenant        ON tenant_automation_policies (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tap_trigger       ON tenant_automation_policies (tenant_id, trigger_key) WHERE enabled;

-- RLS: FORCE + tenant_isolation on app.tenant_id (same as proposal_portals, mig 097).
ALTER TABLE tenant_automation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_automation_policies FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_automation_policies;
CREATE POLICY tenant_isolation ON tenant_automation_policies
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_automation_policies TO govtech_app;

DROP TRIGGER IF EXISTS tap_updated ON tenant_automation_policies;
CREATE TRIGGER tap_updated BEFORE UPDATE ON tenant_automation_policies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
