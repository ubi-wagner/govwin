-- Migration 177: template stable + template bridge — mirror of the opportunity-card
-- spine (mig 094) for pristine templates.
--
-- Design: docs/TEMPLATE_BRIDGE_DESIGN.md.
--
-- The template BRIDGE is the sole admin->customer coupling for templates: global,
-- admin-written, append-only, forward-only. TENANT TEMPLATE CARDS are denormalized
-- snapshots (NO FK to the master) fed forward-only from the bridge, so every tenant
-- OWNS a copy of every template — killing the "shared is_system / live-download"
-- deprecation risk (a customer's template shelf can never change/break under them;
-- an admin can only push a NEW version forward that they opt into). Once a template
-- is instantiated into a doc, that doc is the artifact; the template is skeleton-only.
--
-- ISOLATION: tenant_template_cards ENABLE + FORCE RLS keyed on the app.tenant_id GUC
-- (lib/rls.ts), same proven pattern as tenant_opportunity_cards. Inert under the
-- owner role until the govtech_app cutover; one flip arms it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'govtech_app') THEN
    CREATE ROLE govtech_app NOLOGIN;
  END IF;
END $$;

-- ── Master template store (admin-editable source of truth; seeded from lib/templates) ──
-- Distinct from document_templates (the legacy shared is_system rows) — this is the
-- versioned master that publishes to the bridge. Consolidation of document_templates
-- onto this store is a later phase (docs/TEMPLATE_BRIDGE_DESIGN.md §6).
CREATE TABLE IF NOT EXISTS master_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key    TEXT NOT NULL UNIQUE,          -- stable catalog key (e.g. 'dod-sbir-phase1-technical')
    title           TEXT NOT NULL,
    category        TEXT NOT NULL,                 -- dod_dow | nsf | doe | marketing | tech | company | investment
    agency          TEXT,
    format          TEXT NOT NULL DEFAULT 'document' CHECK (format IN ('document','deck','spreadsheet')),
    canvas_document JSONB NOT NULL,                -- the pristine CanvasDocument ({anchor}-only, no real data)
    version         INT  NOT NULL DEFAULT 1,       -- master version (bumped on republish)
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated')),
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mastertpl_category ON master_templates (category, status);
DROP TRIGGER IF EXISTS mastertpl_updated ON master_templates;
CREATE TRIGGER mastertpl_updated BEFORE UPDATE ON master_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
GRANT SELECT, INSERT, UPDATE ON master_templates TO govtech_app;

-- ── L0: forward-only template bridge (global, admin-write, append-only) ──
CREATE TABLE IF NOT EXISTS template_bridge (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id  UUID NOT NULL REFERENCES master_templates(id),
    version      INT  NOT NULL,                    -- monotonic per template
    event_type   TEXT NOT NULL CHECK (event_type IN ('published','updated','deprecated','republished')),
    template     JSONB NOT NULL,                   -- full template snapshot at this version (the copied payload)
    posted_by    UUID REFERENCES users(id),
    posted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (template_id, version)
);
CREATE INDEX IF NOT EXISTS idx_tplbridge_tpl    ON template_bridge (template_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_tplbridge_posted ON template_bridge (posted_at);
GRANT SELECT, INSERT ON template_bridge TO govtech_app;

-- ── L1: per-tenant denormalized template card (RLS-forced, owned copy) ──
CREATE TABLE IF NOT EXISTS tenant_template_cards (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    template_id      UUID NOT NULL,                -- soft ref (card carries the snapshot); shard-safe, no FK to master
    template         JSONB NOT NULL,               -- the copied pristine snapshot (no JOIN to master)
    bridge_version   INT  NOT NULL DEFAULT 0,      -- last bridge version applied to this card
    template_key     TEXT NOT NULL,
    title            TEXT NOT NULL,
    category         TEXT NOT NULL,
    agency           TEXT,
    format           TEXT NOT NULL DEFAULT 'document',
    update_available BOOLEAN NOT NULL DEFAULT false, -- a newer bridge version posted; tenant can resync the skeleton
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, template_id)
);
CREATE INDEX IF NOT EXISTS idx_ttc_tenant   ON tenant_template_cards (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ttc_category ON tenant_template_cards (tenant_id, category);
DROP TRIGGER IF EXISTS ttc_updated ON tenant_template_cards;
CREATE TRIGGER ttc_updated BEFORE UPDATE ON tenant_template_cards
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE tenant_template_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_template_cards FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_template_cards;
CREATE POLICY tenant_isolation ON tenant_template_cards
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_template_cards TO govtech_app;
