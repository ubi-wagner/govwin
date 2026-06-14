-- =============================================================================
-- CRM Migration 011: deploy baseline marker (CRM DB) — no-op, idempotent
-- -----------------------------------------------------------------------------
-- Harmless marker so a CMS/CRM deploy exercises the CRM migration runner end to
-- end (services/cms/db/run.sh). Records a baseline row; touches no CRM table and
-- leaves cms_posts / email_accounts / email_outbox untouched. Safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS deploy_baseline (
    id           TEXT PRIMARY KEY,
    note         TEXT,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO deploy_baseline (id, note)
VALUES ('2026-06-14-crm', 'baseline: CRM DB migration runner verified on deploy')
ON CONFLICT (id) DO NOTHING;
