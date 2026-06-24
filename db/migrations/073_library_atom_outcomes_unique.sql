-- Migration 073: idempotent outcome recording
--
-- library_atom_outcomes had no unique constraint on (unit_id, proposal_id), so
-- the outcome route's `ON CONFLICT (unit_id, proposal_id) DO NOTHING` had no
-- arbiter index and re-recording an outcome inserted duplicate audit rows.
-- (It did NOT 500 — bare ON CONFLICT DO NOTHING matched all indexes — but the
-- dedupe never fired.) Add the constraint so re-recording is idempotent.

-- 1. Collapse any pre-existing duplicates, keeping the earliest row.
DELETE FROM library_atom_outcomes a
USING library_atom_outcomes b
WHERE a.id > b.id
  AND a.unit_id = b.unit_id
  AND a.proposal_id = b.proposal_id;

-- 2. Add the unique constraint (guarded so the migration is re-runnable).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'library_atom_outcomes_unit_proposal_key'
  ) THEN
    ALTER TABLE library_atom_outcomes
      ADD CONSTRAINT library_atom_outcomes_unit_proposal_key
      UNIQUE (unit_id, proposal_id);
  END IF;
END $$;
