-- 233_modification_change_clin_restrict.sql
--
-- A defect in migration 230, found by a probe that was doing something else entirely.
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────────────────────
-- `project_modification_changes.clin_id` was declared `ON DELETE SET NULL`, and the same migration
-- declared a CHECK requiring `action='amend'` rows to carry one:
--
--   CHECK ((action='amend' AND clin_id IS NOT NULL AND field IS NOT NULL) OR …)
--
-- Those two cannot both hold. The moment anything removed a CLIN, the FK tried to null the column
-- and the CHECK refused — so **a project carrying an executed modification could not be deleted at
-- all**, and the error a person saw named a constraint on a table they had never heard of:
--
--   ERROR: new row for relation "project_modification_changes" violates check constraint
--          "project_modification_changes_shape"
--   CONTEXT: UPDATE ONLY "project_modification_changes" SET "clin_id" = NULL
--
-- It surfaced while clearing scratch fixtures, which is the only reason it surfaced at all: the
-- product archives rather than deletes, so no customer path reaches this today. That makes it the
-- kind of defect that waits.
--
-- ── THE FIX IS THE RULE THE INVOICE LINES ALREADY HAVE ───────────────────────────────────────
-- `project_invoice_lines.clin_id` is `ON DELETE RESTRICT`, for a reason stated in migration 231: a
-- CLIN with billing against it must not be deletable. A CLIN with MODIFICATION HISTORY against it
-- is the same claim — "this line item's funded amount moved from $750,000 to $900,000 on 4 May" is
-- meaningless once the line item is gone, and a nulled reference would leave the record standing
-- while quietly detaching it from what it describes.
--
-- So the two tables now say the same thing, which they should have from the start. RESTRICT does
-- NOT block deleting a PROJECT — verified: the cascade removes the modification rows before it
-- reaches the CLINs — it blocks deleting a CLIN out from under its own history, which is correct.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

ALTER TABLE project_modification_changes
  DROP CONSTRAINT IF EXISTS project_modification_changes_clin_id_fkey;

ALTER TABLE project_modification_changes
  ADD CONSTRAINT project_modification_changes_clin_id_fkey
  FOREIGN KEY (clin_id) REFERENCES project_clins(id) ON DELETE RESTRICT;

COMMENT ON COLUMN project_modification_changes.clin_id IS
  'For an amend: which CLIN this change moves, RESTRICT so the line item cannot be deleted out '
  'from under its own history. For an add_clin: NULL until execution, then the CLIN that was '
  'created — the change row points at its own result and the trail closes. Same rule as '
  'project_invoice_lines.clin_id (mig 231); migration 230 had SET NULL, which its own CHECK made '
  'impossible.';
