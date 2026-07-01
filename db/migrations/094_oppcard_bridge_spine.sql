-- Migration 094: greenfield opportunity-card spine — L0 forward-only bridge +
-- L1 per-tenant denormalized card, RLS-native.
--
-- Design: docs/OPPORTUNITY_CARD_LIFECYCLE_AND_BRIDGE_DESIGN_2026-07-01.md +
--         docs/OPPORTUNITY_CARD_V1_EXISTS_VS_GAPS_2026-07-01.md.
--
-- The BRIDGE is the sole admin->customer coupling (the shard seam): global,
-- admin-written, append-only, forward-only. TENANT CARDS are denormalized
-- snapshots (NO FK to global opportunities) fed forward-only from the bridge, so a
-- tenant's pipeline is self-sufficient for a future per-customer DB split.
-- opportunity_id stays the immutable spine key (mig 088); status stays
-- domain-owned. Additive: the legacy tenant_pipeline_items path is untouched until
-- cutover.
--
-- ISOLATION FOUNDATION (true RLS, not convention): the new tenant tables ENABLE +
-- FORCE row-level security with a policy keyed on the `app.tenant_id` GUC. The app
-- reaches them through a helper that SETs that GUC per transaction (lib/rls.ts).
-- ACTIVATION: point the app's login role at the non-owner `govtech_app` role (or
-- GRANT it). Until activated, a superuser/owner connection bypasses FORCE (same
-- app-level isolation as today) — the pattern is proven and one config flip arms it.

-- ── Non-owner app role (activation target) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'govtech_app') THEN
    CREATE ROLE govtech_app NOLOGIN;
  END IF;
END $$;

-- ── L0: forward-only bridge (global, admin-write, append-only) ──
CREATE TABLE IF NOT EXISTS opportunity_bridge (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id  UUID NOT NULL REFERENCES opportunities(id),
    version         INT  NOT NULL,                 -- monotonic per opportunity
    event_type      TEXT NOT NULL CHECK (event_type IN ('published','updated','closed','reopened','awarded')),
    card            JSONB NOT NULL,                -- full customer-visible card snapshot at this version
    posted_by       UUID REFERENCES users(id),
    posted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (opportunity_id, version)
);
CREATE INDEX IF NOT EXISTS idx_oppbridge_opp    ON opportunity_bridge (opportunity_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_oppbridge_posted ON opportunity_bridge (posted_at);
CREATE INDEX IF NOT EXISTS idx_oppbridge_id_seq ON opportunity_bridge (posted_at, id);
-- Global feed: the system consumer reads it and fans out to tenant cards.
GRANT SELECT, INSERT ON opportunity_bridge TO govtech_app;

-- ── L1: per-tenant denormalized thin card (RLS-forced) ──
CREATE TABLE IF NOT EXISTS tenant_opportunity_cards (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id            UUID NOT NULL REFERENCES tenants(id),
    opportunity_id       UUID NOT NULL,            -- soft ref (card carries display); shard-safe, no FK to global
    card                 JSONB NOT NULL,           -- customer-visible snapshot (no JOIN to global)
    bridge_version       INT  NOT NULL DEFAULT 0,  -- last bridge version applied to this card
    lifecycle_status     TEXT NOT NULL DEFAULT 'open'       CHECK (lifecycle_status IN ('open','closed','archived')),
    pursuit_status       TEXT NOT NULL DEFAULT 'unreviewed' CHECK (pursuit_status IN ('unreviewed','pursuing','monitoring','passed')),
    is_pinned            BOOLEAN NOT NULL DEFAULT false,
    pin_update_available BOOLEAN NOT NULL DEFAULT false,     -- set when a newer bridge version posts for a pinned card
    pinned_at            TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, opportunity_id)
);
CREATE INDEX IF NOT EXISTS idx_toc_tenant        ON tenant_opportunity_cards (tenant_id);
CREATE INDEX IF NOT EXISTS idx_toc_tenant_pinned ON tenant_opportunity_cards (tenant_id, is_pinned) WHERE is_pinned;
CREATE INDEX IF NOT EXISTS idx_toc_opp           ON tenant_opportunity_cards (opportunity_id);
DROP TRIGGER IF EXISTS toc_updated ON tenant_opportunity_cards;
CREATE TRIGGER toc_updated BEFORE UPDATE ON tenant_opportunity_cards
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_opportunity_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_opportunity_cards FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_opportunity_cards;
CREATE POLICY tenant_isolation ON tenant_opportunity_cards
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_opportunity_cards TO govtech_app;

-- ── Bridge subscription cursor (per tenant): forward-only catch-up + backfill ──
-- System table (the cross-tenant consumer reads/writes all rows to fan out); not
-- customer-facing, so intentionally NOT under tenant RLS.
CREATE TABLE IF NOT EXISTS tenant_bridge_cursor (
    tenant_id       UUID PRIMARY KEY REFERENCES tenants(id),
    last_posted_at  TIMESTAMPTZ NOT NULL DEFAULT '1970-01-01T00:00:00Z',
    last_event_id   UUID,
    last_applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON tenant_bridge_cursor TO govtech_app;
