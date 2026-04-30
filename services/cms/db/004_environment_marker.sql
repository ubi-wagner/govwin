-- 004_environment_marker.sql
--
-- Adds deploy_environment tracking to the CRM database.
-- Purely additive. Idempotent.

CREATE TABLE IF NOT EXISTS _crm_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO _crm_metadata (key, value)
VALUES ('deploy_environment', 'unknown')
ON CONFLICT (key) DO NOTHING;
