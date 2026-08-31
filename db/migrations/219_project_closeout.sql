-- 219_project_closeout.sql
--
-- Close-out: the end of the project's life, recorded the same way its milestones are.
--
-- ── WHY A STATUS FLIP IS NOT ENOUGH ──────────────────────────────────────────────────────────
-- `projects.status` already carries `planning | active | closing | closed` (mig 216), so a project
-- could be "closed" by an UPDATE today. What that leaves out is everything a person asks six months
-- later: when, by whom, on what terms, and against what final numbers. A closed project with no
-- record is a row that stopped changing, which is not the same as a contract that finished.
--
-- So close-out mirrors milestone completion exactly — a note and open jsonb metrics — because they
-- are the same act at two scales, and two different shapes for one idea is how they drift.
--
-- ── AND WHY IT IS REVERSIBLE ─────────────────────────────────────────────────────────────────
-- Government close-out reopens: a final invoice is disputed, property is unreturned, an audit lands.
-- `closed_at` is cleared on reopen rather than a second column being added, and the event pair
-- (`project.closed` / `project.reopened`) is the history. This repo's rule is that nothing is
-- hard-deleted and archive is soft and reversible; close-out follows it.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS closed_at         timestamptz,
  ADD COLUMN IF NOT EXISTS closed_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closeout_note     text,
  ADD COLUMN IF NOT EXISTS closeout_metrics  jsonb;

-- The status and the stamp agree, or neither can be trusted. Without this they disagree the first
-- time someone flips a status without the stamp, and every "when did this finish" report reads the
-- stale one — the same CHECK mig 218 puts on a done task.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_closed_has_time') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_closed_has_time
      CHECK ((status = 'closed') = (closed_at IS NOT NULL));
  END IF;
END $$;

-- Metrics are an OBJECT. Written through `sql.json(...)` they always are; this stops the jsonb
-- shape bug that has recurred in this repo — a string stored as jsonb reads back as a string and
-- then char-iterates.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'projects_closeout_metrics_is_object') THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_closeout_metrics_is_object
      CHECK (closeout_metrics IS NULL OR jsonb_typeof(closeout_metrics) = 'object');
  END IF;
END $$;

-- The nudge sweep already skips `status = 'closed'`; this index is what makes that cheap once a
-- tenant has years of finished work.
CREATE INDEX IF NOT EXISTS idx_projects_open
  ON projects (tenant_id, created_at DESC)
  WHERE status <> 'closed';
