-- 010_phase1_shredder.sql
--
-- Phase 1 §D — AI Shredder and Compliance Extraction.
--
-- Adds:
--   1. pipeline_jobs.kind — discriminator between 'ingest' and
--      'shred_solicitation' jobs. The Phase 1 §C dispatcher uses this
--      to route jobs to either an ingester (INGESTERS dict) or the
--      shredder runner.
--   2. curated_solicitations.status += 'shredder_failed' — the state
--      transition when the shredder hits ShredderBudgetError or any
--      unrecoverable error during pdf extraction / Claude call.
--   3. Partial index on (kind, status) for dispatcher queries that
--      filter by job kind (e.g. "next pending shred job").
--
-- Purely ADDITIVE. Uses IF NOT EXISTS + DO $$ guards so applying twice
-- is a no-op. Gated by the same run.sh tracking table used by 005-009.

-- ============================================================================
-- 1. pipeline_jobs.kind column
-- ============================================================================

ALTER TABLE pipeline_jobs
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'ingest';

-- Constrain to the two known kinds. A future Phase may add more
-- (e.g. 'embed_memory') — extend this CHECK at that time.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_jobs_kind_check'
      AND conrelid = 'pipeline_jobs'::regclass
  ) THEN
    ALTER TABLE pipeline_jobs
      ADD CONSTRAINT pipeline_jobs_kind_check
      CHECK (kind IN ('ingest', 'shred_solicitation'));
  END IF;
END $$;

-- Partial index for the shred-job dispatch query
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_pending_by_kind
  ON pipeline_jobs (kind, priority DESC, created_at ASC)
  WHERE status = 'pending';

-- ============================================================================
-- 2. curated_solicitations.status += 'shredder_failed'
-- ============================================================================
-- Expand the existing CHECK constraint by dropping + recreating it
-- with the new state appended. Guard against re-running by checking
-- whether 'shredder_failed' is already covered.

DO $$
DECLARE
  conname_found TEXT;
  condef TEXT;
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO conname_found, condef
  FROM pg_constraint
  WHERE conrelid = 'curated_solicitations'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
  LIMIT 1;

  IF conname_found IS NULL THEN
    RAISE NOTICE 'no status check constraint on curated_solicitations; adding fresh';
    ALTER TABLE curated_solicitations
      ADD CONSTRAINT curated_solicitations_status_check
      CHECK (status IN (
        'new','claimed','released','released_for_analysis','ai_analyzed',
        'shredder_failed','curation_in_progress','review_requested',
        'approved','pushed_to_pipeline','dismissed','rejected_review'
      ));
  ELSIF condef NOT LIKE '%shredder_failed%' THEN
    EXECUTE format('ALTER TABLE curated_solicitations DROP CONSTRAINT %I', conname_found);
    ALTER TABLE curated_solicitations
      ADD CONSTRAINT curated_solicitations_status_check
      CHECK (status IN (
        'new','claimed','released','released_for_analysis','ai_analyzed',
        'shredder_failed','curation_in_progress','review_requested',
        'approved','pushed_to_pipeline','dismissed','rejected_review'
      ));
  ELSE
    RAISE NOTICE 'shredder_failed already in status check — skipping';
  END IF;
END $$;
