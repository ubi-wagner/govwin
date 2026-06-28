-- Migration 076: per-tenant automation preferences (Phase 3, C3)
--
-- The customer admin's automation choices, configured at portal purchase
-- (and editable later). These gate the milestone automations driven by the
-- already-emitted proposal lifecycle events (document.locked, advance_ready,
-- proposal.advanced) — the "set that up when they purchase a portal" surface.
--
-- One row per tenant (1:1). Rows are created lazily (upsert-on-read) so a
-- tenant without a row simply gets the conservative defaults below.

CREATE TABLE IF NOT EXISTS tenant_automation_preferences (
    tenant_id                       UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

    -- Notifications (off the emitted milestone events)
    notify_team_on_document_locked  BOOLEAN NOT NULL DEFAULT true,   -- a document/volume closes
    notify_collaborators_get_ready  BOOLEAN NOT NULL DEFAULT true,   -- "get ready" emails to collaborators
    notify_on_stage_advanced        BOOLEAN NOT NULL DEFAULT true,   -- proposal advances a stage
    notify_on_new_priority_opp      BOOLEAN NOT NULL DEFAULT true,   -- new high-alignment opportunity

    -- AI-agent tasking
    ai_review_on_advance            BOOLEAN NOT NULL DEFAULT true,   -- agents review on (force-)advance → section recommendations

    -- Flow
    auto_advance_when_all_locked    BOOLEAN NOT NULL DEFAULT false,  -- auto-advance once every section is locked (opt-in)

    preferences                     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- extensibility
    configured_at                   TIMESTAMPTZ,                          -- set when the customer completes setup
    created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);
