-- =============================================================================
-- 009 — Sender Identities: DB-backed "From" addresses for outbound email
--
-- The CMS sends from named identities (src/sender_identity.py::resolve_sender):
--   automation  — system/workflow/HITL traffic (the "robot" voice)
--   engagement  — human-facing onboarding/campaigns/responses (the "person" voice)
--   cms_service — delegated service mailbox for CMS-originated automation
--
-- Until now these addresses came only from env vars. This table makes them
-- admin-editable without a redeploy, and lets new identities be added and selected
-- via a notification's payload.fromIdentity. Resolution precedence in resolve_sender:
--
--     explicit env var  >  this table (active row)  >  hardcoded default
--
-- so env stays the per-deploy ops override while the table is the live config.
-- =============================================================================

CREATE TABLE IF NOT EXISTS sender_identities (
    key          TEXT PRIMARY KEY,          -- 'automation' | 'engagement' | 'cms_service' | custom
    address      TEXT NOT NULL,             -- the From email address
    display_name TEXT,                       -- optional friendly name (reserved for future use)
    description  TEXT,
    active       BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sender_identities_active
    ON sender_identities (active) WHERE active = true;

-- Seed the three canonical identities. ON CONFLICT DO NOTHING so a re-run never
-- clobbers an admin's edits.
INSERT INTO sender_identities (key, address, display_name, description) VALUES
    ('automation', 'automation@rfppipeline.com', 'RFP Pipeline',
        'System/automation traffic: workflow NOTIFY, admin alerts, HITL nudges, sweeps.'),
    ('engagement', 'eric@rfppipeline.com', 'Eric Wagner — RFP Pipeline',
        'Human-facing: customer onboarding, campaigns/drips, reply responses.'),
    ('cms_service', 'cms_gmail_service@rfppipeline.com', 'RFP Pipeline Content',
        'Delegated service mailbox for CMS-originated automation.')
ON CONFLICT (key) DO NOTHING;

-- Keep updated_at honest on admin edits.
CREATE OR REPLACE FUNCTION update_sender_identity_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sender_identity_updated ON sender_identities;
CREATE TRIGGER trg_sender_identity_updated
    BEFORE UPDATE ON sender_identities
    FOR EACH ROW EXECUTE FUNCTION update_sender_identity_timestamp();
