-- Migration 126: automation_framework — the PLATFORM level of the three-level
-- automation-policy model (docs/AUTOMATION_POLICY_DESIGN.md §12, decision ⑦).
--
-- ONE global, RFP-Pipeline-admin-tunable row. These are the "hard to the tenant,
-- tunable by us" defaults + ceilings that the resolver (§4) resolves DOWN to:
--   platform (this row) ▸ tenant policy ▸ portal config ▸ explicit launch override.
-- Framework-HARD values (curation SLA, max buckets, overlay frameworks, agent
-- skills/tools/budget-ceiling) can ONLY be set here — a tenant/portal cannot move them.
--
-- Ships INERT: seeded from today's hardcoded constants (72h SLA = 4320 min, [1,3]
-- nudges, 72h gate due), so resolution is a no-op until a tenant edits a policy.
-- Nothing reads this table yet — the resolver lands in Phase B.

CREATE TABLE IF NOT EXISTS automation_framework (
    id                                 INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton

    -- Curation SLA: the RFP-admin review → build-matrix → release window (business rule).
    curation_sla_minutes               INTEGER NOT NULL DEFAULT 4320,     -- 72h

    -- Default human-gate cadence (the ProjectCollaboration overlay fallbacks).
    default_nudge_days                 INTEGER[] NOT NULL DEFAULT '{1,3}',
    default_due_in_minutes             INTEGER NOT NULL DEFAULT 4320,     -- 72h gate

    -- Tenant limits (hard to the tenant).
    max_buckets_per_tenant             INTEGER NOT NULL DEFAULT 12,
    max_nudges_per_gate                INTEGER NOT NULL DEFAULT 3,

    -- Agent settings: the CEILING a tenant policy may only LOWER below (decision ⑨).
    agent_monthly_budget_ceiling_usd   NUMERIC(10,2) NOT NULL DEFAULT 200.00,
    agent_auto_run_default             BOOLEAN NOT NULL DEFAULT false,
    agent_settings                     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- skills/tools allow-lists

    -- Standard workflow-overlay frameworks a tenant composes from (names/refs, not logic).
    overlay_frameworks                 JSONB NOT NULL DEFAULT '[]'::jsonb,

    updated_by                         UUID REFERENCES users(id),
    updated_at                         TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at                         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the singleton with today's constants (idempotent; the DEFAULTs above are the seed).
INSERT INTO automation_framework (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- The app reads the framework during policy resolution; writes are admin-gated in-app.
-- No RLS: this is global platform config, not tenant-scoped. GRANT read to the future
-- NOBYPASSRLS app role so resolution keeps working post-cutover.
GRANT SELECT ON automation_framework TO govtech_app;

DROP TRIGGER IF EXISTS af_updated ON automation_framework;
CREATE TRIGGER af_updated BEFORE UPDATE ON automation_framework
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
