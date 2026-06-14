-- =============================================================================
-- Migration 061: deploy baseline marker (main DB) — no-op, idempotent
-- -----------------------------------------------------------------------------
-- Harmless marker so a deploy exercises the main-DB migration runner end to end
-- (db/migrations/run.sh via the frontend entrypoint). Records a baseline row and
-- touches no application table. Safe to re-run.
-- =============================================================================

CREATE TABLE IF NOT EXISTS deploy_baseline (
    id           TEXT PRIMARY KEY,
    note         TEXT,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO deploy_baseline (id, note)
VALUES ('2026-06-14-main', 'baseline: main DB migration runner verified on deploy')
ON CONFLICT (id) DO NOTHING;
