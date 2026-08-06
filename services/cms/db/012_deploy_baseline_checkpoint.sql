-- =============================================================================
-- CRM Migration 012: full redeploy checkpoint (CRM DB) — schema check + baseline marker
-- -----------------------------------------------------------------------------
-- Idempotent, no CRM data touched. Forces the CRM migration runner
-- (services/cms/db/run.sh) to run on this deploy AND verifies the core CRM schema is
-- intact before uvicorn serves (run.sh uses ON_ERROR_STOP, so a RAISE here fails the
-- deploy and is not recorded — retriable). Records a deploy_baseline row. Safe to re-run.
-- =============================================================================

DO $$
DECLARE
    missing text := '';
BEGIN
    IF to_regclass('public.cms_posts')       IS NULL THEN missing := missing || ' cms_posts'; END IF;
    IF to_regclass('public.cms_generations') IS NULL THEN missing := missing || ' cms_generations'; END IF;
    IF to_regclass('public.email_accounts')  IS NULL THEN missing := missing || ' email_accounts'; END IF;
    IF to_regclass('public.email_outbox')    IS NULL THEN missing := missing || ' email_outbox'; END IF;

    IF missing <> '' THEN
        RAISE EXCEPTION 'CRM deploy checkpoint 2026-08-05 schema check FAILED — missing core table(s):%', missing;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS deploy_baseline (
    id           TEXT PRIMARY KEY,
    note         TEXT,
    recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO deploy_baseline (id, note)
VALUES ('2026-08-05-crm', 'full redeploy checkpoint: CRM-DB schema verified (cms_posts/cms_generations/email_accounts/email_outbox) on deploy')
ON CONFLICT (id) DO NOTHING;
