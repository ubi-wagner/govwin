-- Migration 126: per-tenant automation policy layer (#190)
--
-- Supersedes the 6-boolean tenant_automation_preferences with a structured,
-- per-trigger policy table that expresses the full grammar:
--   recipients × trigger × timing × escalation × channel
--
-- Design: docs/AUTOMATION_POLICY_DESIGN.md
-- Build order: §11 step 1 (table + RLS + platform framework seed).
--
-- Ships INERT: every un-configured tenant rides the platform framework row,
-- so behaviour is identical to today until a tenant (or RFP admin) edits a rule.
-- The 6-boolean table remains readable (dual-read period); it is retired once
-- frontend routes are fully repointed (mig 1XX).

CREATE TABLE IF NOT EXISTS tenant_automation_policies (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- NULL tenant_id = the platform framework row (RFP-admin-owned defaults).
    -- All tenant rows have a non-null tenant_id.
    tenant_id             UUID REFERENCES tenants(id) ON DELETE CASCADE,

    scope                 TEXT NOT NULL CHECK (scope IN ('discovery', 'build')),
    trigger_key           TEXT NOT NULL,   -- 'namespace:type' matches the system_events river

    enabled               BOOLEAN NOT NULL DEFAULT true,

    -- recipients (who) — resolved to user_ids at fire time
    recipient_roles       TEXT[]  NOT NULL DEFAULT '{}',     -- e.g. {tenant_admin, tenant_user}
    recipient_users       UUID[]  NOT NULL DEFAULT '{}',     -- explicit user IDs
    recipient_flags       TEXT[]  NOT NULL DEFAULT '{}',     -- {delegated_managers, collaborators_at_stage}

    -- trigger refinement (optional condition over event payload)
    condition             JSONB   NOT NULL DEFAULT '{}',     -- conditionsMatch() predicate

    -- timing (when) — exactly one of due_in_minutes or relative_anchor must be set
    due_in_minutes        INTEGER,                           -- absolute build window
    relative_anchor       TEXT CHECK (relative_anchor IN ('open_date', 'close_date', 'stage_entered')),
    relative_offset_minutes INTEGER,                         -- signed; -20160 = 2 weeks before

    -- escalation (nudge cadence; last beat always adds the admin floor)
    nudge_days            INTEGER[] NOT NULL DEFAULT '{1,3}',

    -- delivery channel
    channel               TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'todo', 'both')),

    -- concurrency guards (mirrors automation_rules to prevent spam)
    cooldown_minutes      INTEGER NOT NULL DEFAULT 0,
    max_fires_per_hour    INTEGER NOT NULL DEFAULT 0,

    -- metadata
    configured_at         TIMESTAMPTZ,                        -- set when a human explicitly edits
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- one rule per (tenant, scope, trigger_key); platform framework uses tenant_id IS NULL
    UNIQUE NULLS NOT DISTINCT (tenant_id, scope, trigger_key)
);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Same pattern as proposal_portals (mig 097): force RLS on all connections;
-- tenant rows are visible only when app.tenant_id matches; the platform framework
-- row (tenant_id IS NULL) is visible to all authenticated reads (needed by the
-- resolver fallback path).
ALTER TABLE tenant_automation_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_automation_policies FORCE ROW LEVEL SECURITY;

-- Tenants see their own rows + the platform framework row
CREATE POLICY tenant_isolation ON tenant_automation_policies
    USING (
        tenant_id IS NULL  -- platform framework row — visible to all
        OR tenant_id::text = current_setting('app.tenant_id', true)
    );

-- ── Platform framework seed ────────────────────────────────────────────────
-- One row per lifecycle trigger that is wired today, seeded from the current
-- hardcoded constants. These are the RFP-admin-tunable defaults; a tenant with
-- no override rides these. All ship with enabled=true so the resolver returns
-- a non-null overlay (identical to the current hardcoded behaviour).
--
-- trigger_key follows the system_events 'namespace:type' convention.

INSERT INTO tenant_automation_policies
    (tenant_id, scope, trigger_key, enabled, recipient_roles, nudge_days, due_in_minutes, channel, configured_at)
VALUES
    -- Build: 72h admin review gate (proposals/create → rfp_admin review + unlock)
    (NULL, 'build', 'proposal:proposal.created',
     true, '{rfp_admin}', '{1,3}', 4320, 'todo', now()),

    -- Build: curation gate (portal purchase / Stripe webhook → rfp_admin curates + releases)
    (NULL, 'build', 'capture:purchase.completed',
     true, '{rfp_admin}', '{1,3}', 4320, 'todo', now()),

    -- Build: contract kickoff gate (proposals/outcome → tenant_admin 7d)
    (NULL, 'build', 'proposal:contract.created',
     true, '{tenant_admin}', '{3,1}', 10080, 'todo', now()),

    -- Build: notify team when a document/volume is locked
    (NULL, 'build', 'proposal:document.locked',
     true, '{tenant_admin,tenant_user}', '{1}', NULL, 'email', now()),

    -- Build: notify collaborators to get ready (all sections locked, advance_ready)
    (NULL, 'build', 'proposal:proposal.advance_ready',
     true, '{tenant_admin,tenant_user}', '{1}', NULL, 'email', now()),

    -- Build: notify on stage advancement
    (NULL, 'build', 'proposal:proposal.advanced',
     true, '{tenant_admin,tenant_user}', '{1}', NULL, 'email', now()),

    -- Build: AI review on stage advance (ai_review_on_advance toggle)
    (NULL, 'build', 'proposal:proposal.advanced#ai_review',
     true, '{}', '{}', NULL, 'todo', now()),

    -- Build: auto-advance when all sections are locked (flow control, not notify)
    -- enabled=false by default (opt-in); channel='todo' because it's a flow action.
    (NULL, 'build', 'proposal:sections.all_locked#auto_advance',
     false, '{}', '{}', NULL, 'todo', now()),

    -- Discovery: notify on new high-priority opportunity
    (NULL, 'discovery', 'capture:card.applied',
     true, '{tenant_admin}', '{1,3}', NULL, 'email', now())

ON CONFLICT (tenant_id, scope, trigger_key) DO NOTHING;

-- ── Backfill from tenant_automation_preferences (dual-read period) ────────
-- Each configured boolean maps to one policy row.  Un-configured tenants get no
-- rows here — they ride the platform framework defaults (the safe-skip property).
-- The tenant_automation_preferences table remains readable; it is retired in a
-- later migration once frontend routes are fully repointed to tenant_automation_policies.

INSERT INTO tenant_automation_policies
    (tenant_id, scope, trigger_key, enabled, recipient_roles, nudge_days, channel, configured_at)
SELECT
    p.tenant_id,
    'build',
    'proposal:document.locked',
    p.notify_team_on_document_locked,
    '{tenant_admin,tenant_user}',
    '{1}',
    'email',
    p.configured_at
FROM tenant_automation_preferences p
WHERE p.configured_at IS NOT NULL
ON CONFLICT (tenant_id, scope, trigger_key) DO NOTHING;

INSERT INTO tenant_automation_policies
    (tenant_id, scope, trigger_key, enabled, recipient_roles, nudge_days, channel, configured_at)
SELECT
    p.tenant_id,
    'build',
    'proposal:proposal.advance_ready',
    p.notify_collaborators_get_ready,
    '{tenant_admin,tenant_user}',
    '{1}',
    'email',
    p.configured_at
FROM tenant_automation_preferences p
WHERE p.configured_at IS NOT NULL
ON CONFLICT (tenant_id, scope, trigger_key) DO NOTHING;

INSERT INTO tenant_automation_policies
    (tenant_id, scope, trigger_key, enabled, recipient_roles, nudge_days, channel, configured_at)
SELECT
    p.tenant_id,
    'build',
    'proposal:proposal.advanced',
    p.notify_on_stage_advanced,
    '{tenant_admin,tenant_user}',
    '{1}',
    'email',
    p.configured_at
FROM tenant_automation_preferences p
WHERE p.configured_at IS NOT NULL
ON CONFLICT (tenant_id, scope, trigger_key) DO NOTHING;

INSERT INTO tenant_automation_policies
    (tenant_id, scope, trigger_key, enabled, recipient_roles, nudge_days, channel, configured_at)
SELECT
    p.tenant_id,
    'discovery',
    'capture:card.applied',
    p.notify_on_new_priority_opp,
    '{tenant_admin}',
    '{1,3}',
    'email',
    p.configured_at
FROM tenant_automation_preferences p
WHERE p.configured_at IS NOT NULL
ON CONFLICT (tenant_id, scope, trigger_key) DO NOTHING;

-- AI review on advance (ai_review_on_advance) — maps to the '#ai_review' sub-key
INSERT INTO tenant_automation_policies
    (tenant_id, scope, trigger_key, enabled, recipient_roles, nudge_days, channel, configured_at)
SELECT
    p.tenant_id,
    'build',
    'proposal:proposal.advanced#ai_review',
    p.ai_review_on_advance,
    '{}',
    '{}',
    'todo',
    p.configured_at
FROM tenant_automation_preferences p
WHERE p.configured_at IS NOT NULL
ON CONFLICT (tenant_id, scope, trigger_key) DO NOTHING;

-- Auto-advance when all sections locked (auto_advance_when_all_locked) — flow control
INSERT INTO tenant_automation_policies
    (tenant_id, scope, trigger_key, enabled, recipient_roles, nudge_days, channel, configured_at)
SELECT
    p.tenant_id,
    'build',
    'proposal:sections.all_locked#auto_advance',
    p.auto_advance_when_all_locked,
    '{}',
    '{}',
    'todo',
    p.configured_at
FROM tenant_automation_preferences p
WHERE p.configured_at IS NOT NULL
ON CONFLICT (tenant_id, scope, trigger_key) DO NOTHING;
