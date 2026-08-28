-- 237 · A BEFORE DELETE trigger that returns NEW returns NULL, and NULL cancels the delete.
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────────────────────────
-- Migration 230 gave `project_modifications` and `project_modification_changes` a freeze: once a
-- modification is executed, its rows are the record of what was applied and may not be altered.
-- Both guard functions end:
--
--     RETURN NEW;
--
-- On an UPDATE that is correct. **On a DELETE, `NEW` is NULL** — and a BEFORE row trigger that
-- returns NULL SILENTLY CANCELS the operation for that row. Postgres does not raise; it simply
-- does not delete, and the statement reports success.
--
-- ONLY ONE OF THE TWO TRIGGERS IS ACTUALLY WIRED TO DELETE, and being precise about which matters
-- more than the fix:
--
--   trg_project_modification_change_frozen   BEFORE DELETE OR UPDATE   ← the live defect
--   trg_project_modification_frozen          BEFORE UPDATE only        ← never reached on a delete
--
-- Deleting an executed `project_modifications` row is PERMITTED by design — a project cascade has
-- to be able to remove it, which is the same reasoning migration 234 settled the CLIN children on.
-- The `TG_OP = 'DELETE'` branch added to that function below is therefore defensive rather than
-- corrective: it is what the function should return if the trigger ever gains DELETE, and it
-- changes nothing today. Saying both were broken would have been the tidier sentence and the
-- wrong one.
--
-- So every DELETE on `project_modification_changes` was discarded, including the ones the freeze
-- deliberately permits. Measured on a DRAFT modification's change row, which the guard explicitly
-- lets through:
--
--     before_delete  1
--     DELETE ...        -- reported success
--     after_delete   1
--
-- ── WHAT IT COST, WHICH IS NOT HYPOTHETICAL ──────────────────────────────────────────────────
-- FK `ON DELETE CASCADE` fires row triggers. So when a project cascade removed a
-- `project_modifications` row, the cascade's delete of its child change rows was cancelled the
-- same way — leaving CHILDREN WITHOUT PARENTS, which is precisely the state migration 234's
-- CASCADE exists to prevent.
--
-- It surfaced restoring a `pg_dump` of this sandbox: 62 orphaned `project_modification_changes`
-- rows, and two foreign keys that could not be re-attached because their parents were gone. The
-- database had been quietly accumulating unreferenced history, and the only reason anyone looked
-- is that `pg_restore` refuses to add a constraint the data violates.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────────────────────────
-- Return OLD on DELETE. The RAISE that enforces the freeze is unchanged and still fires first —
-- this only corrects what the function returns when it decides to ALLOW the operation.
--
-- Nothing else in this tree has the shape: `project_baseline_is_immutable`,
-- `project_invoice_line_is_frozen` and `project_invoice_status_forward` are BEFORE UPDATE only,
-- where returning NEW is right. `trg_project_modification_change_frozen` was the ONLY trigger in
-- the tree with DELETE in its event and NEW as its return.

BEGIN;

CREATE OR REPLACE FUNCTION project_modification_is_frozen() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'executed' THEN
    RAISE EXCEPTION
      'Modification % is executed and cannot be changed; record a new modification instead.',
      OLD.mod_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- OLD on DELETE, NEW on UPDATE. Returning NEW on a DELETE returns NULL, and a BEFORE row
  -- trigger returning NULL cancels the row's operation without raising — the statement reports
  -- success and the row stays.
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION project_modification_change_is_frozen() RETURNS trigger AS $$
DECLARE parent_status text; parent_number text;
BEGIN
  SELECT status, mod_number INTO parent_status, parent_number
    FROM project_modifications WHERE id = OLD.modification_id;
  -- `applied_at` is written BY the execution itself, in the same transaction that flips the parent
  -- to 'executed'. The guard has to let that through and refuse everything after, so it keys on the
  -- row already carrying a stamp rather than on the parent's status alone.
  IF parent_status = 'executed' AND OLD.applied_at IS NOT NULL THEN
    RAISE EXCEPTION
      'Modification % is executed; its change rows are the record of what was applied.',
      parent_number
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── CLEAN UP WHAT THE DEFECT LEFT BEHIND ─────────────────────────────────────────────────────
-- Change rows whose modification or CLIN no longer exists. They are unreachable by every read
-- path (each joins its parent), and they are the reason the two foreign keys could not be
-- re-attached. Deleting them is not discarding history: the history they belonged to was deleted,
-- and these rows only survived because the cascade was cancelled.
--
-- The guard would refuse an EXECUTED modification's rows — but an orphan has no parent to be
-- executed, so `parent_status` is NULL and the RAISE cannot fire. The delete is now permitted and,
-- with this migration's fix, actually happens.
DELETE FROM project_modification_changes c
 WHERE NOT EXISTS (SELECT 1 FROM project_modifications m WHERE m.id = c.modification_id)
    OR (c.clin_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_clins k WHERE k.id = c.clin_id));

COMMIT;
