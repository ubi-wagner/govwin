-- 005_dedupe_pipeline_schedules.sql
--
-- Cleanup migration for the pipeline_schedules table on existing
-- deploys (Railway). Two prior bugs left this table in a state where
-- it could accumulate duplicate rows on every workflow run:
--
-- 1. The CREATE TABLE in 001_baseline.sql did not declare
--    UNIQUE(source) on the table. (Fixed in 001_baseline.sql by
--    the same PR as this migration.)
-- 2. The INSERT in 002_seed_system.sql used `ON CONFLICT DO NOTHING`
--    with no conflict target. With no UNIQUE constraint to bind to,
--    the conflict path could never fire — every re-run of the seed
--    inserted 7 fresh rows instead of being a no-op. (Fixed in
--    002_seed_system.sql by the same PR as this migration.)
--
-- Combined, those two bugs meant pipeline_schedules grew by 7 rows
-- every time the migrate.yml workflow ran (which is every push to
-- main that touches db/migrations/**). On fresh deploys this is
-- harmless because 001_baseline.sql now creates the constraint at
-- table creation time. On EXISTING deploys (the Railway DB), the
-- table may already have duplicate rows AND lack the constraint.
--
-- This migration handles both cases idempotently:
--   1. Delete duplicate rows, keeping the oldest (by created_at) for
--      each source. If there are no duplicates, the DELETE is a no-op.
--   2. Add the UNIQUE(source) constraint via ALTER TABLE, gated by
--      a DO block that checks pg_constraint first so re-running this
--      migration doesn't fail with "constraint already exists".
--
-- After this migration runs once, all future runs are no-ops:
-- the dedupe DELETE has nothing to delete, and the constraint
-- already exists.

-- Step 1: dedupe by source, keeping the oldest row.
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY source ORDER BY created_at, id) AS rn
  FROM pipeline_schedules
)
DELETE FROM pipeline_schedules
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Step 2: add the UNIQUE constraint, but only if it doesn't exist.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pipeline_schedules_source_key'
      AND conrelid = 'pipeline_schedules'::regclass
  ) THEN
    ALTER TABLE pipeline_schedules
      ADD CONSTRAINT pipeline_schedules_source_key UNIQUE (source);
  END IF;
END $$;
