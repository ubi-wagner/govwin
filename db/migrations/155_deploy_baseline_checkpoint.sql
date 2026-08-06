-- =============================================================================
-- Migration 155: full redeploy checkpoint (main DB) — schema check + baseline marker
-- -----------------------------------------------------------------------------
-- Idempotent, no application table touched. Forces the main-DB migration runner to
-- run on this deploy AND verifies the core schema is intact before the app serves —
-- most importantly idx_process_instances_dedup, the ON CONFLICT arbiter that mig 154
-- repaired. Its absence silently threw "no unique or exclusion constraint matching the
-- ON CONFLICT specification" on every workflow launch in prod, so re-asserting it here
-- turns any such drift into a loud, deploy-blocking failure instead of a silent outage.
-- Records a deploy_baseline row. Safe to re-run.
-- =============================================================================

DO $$
DECLARE
    missing text := '';
BEGIN
    IF to_regclass('public.process_instances')        IS NULL THEN missing := missing || ' process_instances'; END IF;
    IF to_regclass('public.opportunities')            IS NULL THEN missing := missing || ' opportunities'; END IF;
    IF to_regclass('public.curated_solicitations')    IS NULL THEN missing := missing || ' curated_solicitations'; END IF;
    IF to_regclass('public.system_events')            IS NULL THEN missing := missing || ' system_events'; END IF;
    IF to_regclass('public.proposals')                IS NULL THEN missing := missing || ' proposals'; END IF;
    IF to_regclass('public.tenant_opportunity_cards') IS NULL THEN missing := missing || ' tenant_opportunity_cards'; END IF;
    IF to_regclass('public.library_atoms')            IS NULL THEN missing := missing || ' library_atoms'; END IF;
    -- Critical ON CONFLICT arbiter (mig 154): every event-triggered workflow launch
    -- depends on this partial unique index existing.
    IF to_regclass('public.idx_process_instances_dedup') IS NULL THEN missing := missing || ' idx_process_instances_dedup'; END IF;

    IF missing <> '' THEN
        RAISE EXCEPTION 'deploy checkpoint 2026-08-05 schema check FAILED — missing core object(s):%', missing;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS deploy_baseline (
    id           TEXT PRIMARY KEY,
    note         TEXT,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO deploy_baseline (id, note)
VALUES ('2026-08-05-main', 'full redeploy checkpoint: main-DB schema verified (core tables + idx_process_instances_dedup) on deploy')
ON CONFLICT (id) DO NOTHING;
