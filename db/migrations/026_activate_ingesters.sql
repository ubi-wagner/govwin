-- 026_activate_ingesters.sql
--
-- Activate the dormant ingesters with daily schedules and add the
-- new DSIP ingester. Also extends the pipeline_jobs.kind CHECK
-- constraint to include 'scout_source' for the manual scout trigger.
--
-- Purely additive. Idempotent via ON CONFLICT.

-- ─── Seed pipeline_schedules for existing ingesters ────────────────
-- sam_gov / sbir_gov / grants_gov are already seeded in 002_seed_system.sql
-- but without next_run_at values. Update them so they actually start running.

UPDATE pipeline_schedules
SET next_run_at = now() + interval '1 hour'
WHERE source = 'sam_gov' AND next_run_at IS NULL;

UPDATE pipeline_schedules
SET next_run_at = now() + interval '2 hours'
WHERE source = 'sbir_gov' AND next_run_at IS NULL;

-- Grants.gov stays disabled (seeded as enabled=true in 002 but we
-- disable it until the adapter is field-tested).
UPDATE pipeline_schedules
SET enabled = false, next_run_at = NULL
WHERE source = 'grants_gov';

-- ─── Add DSIP ingester schedule ────────────────────────────────────

INSERT INTO pipeline_schedules (source, run_type, cron_expression, enabled, next_run_at)
VALUES ('dsip', 'incremental', '0 5 * * *', true, now() + interval '30 minutes')
ON CONFLICT (source) DO NOTHING;

-- ─── Extend pipeline_jobs.kind CHECK to include 'scout_source' ────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_jobs_kind_check'
      AND conrelid = 'pipeline_jobs'::regclass
  ) THEN
    ALTER TABLE pipeline_jobs
      DROP CONSTRAINT pipeline_jobs_kind_check;
  END IF;

  ALTER TABLE pipeline_jobs
    ADD CONSTRAINT pipeline_jobs_kind_check
    CHECK (kind IN ('ingest', 'shred_solicitation', 'scout_source'));
END $$;
