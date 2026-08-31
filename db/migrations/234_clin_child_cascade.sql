-- 234_clin_child_cascade.sql
--
-- Correcting migration 233, which was wrong for a reason worth writing down.
--
-- ── THE CHAIN OF THREE ───────────────────────────────────────────────────────────────────────
-- Migration 230 gave `project_modification_changes.clin_id` an `ON DELETE SET NULL` alongside a
-- CHECK requiring an `amend` row to carry one. Those cannot both hold, and a project with an
-- executed modification could not be deleted.
--
-- Migration 233 changed it to RESTRICT, matching `project_invoice_lines.clin_id` — and asserted, in
-- its own header, that RESTRICT does not block deleting a PROJECT because the cascade removes the
-- modification rows first. **That was a guess, and it was wrong.** Postgres reached `project_clins`
-- before the modification rows were gone:
--
--   ERROR: update or delete on table "project_clins" violates foreign key constraint
--          "project_modification_changes_clin_id_fkey"
--
-- Which means `project_invoice_lines.clin_id` has carried the same latent defect since migration
-- 231, unnoticed only because the modification constraint failed first and masked it.
--
-- ── WHY CASCADE IS RIGHT HERE, AND NOT A CAPITULATION ────────────────────────────────────────
-- Neither SET NULL nor RESTRICT can express "protect this row, unless the whole project is going
-- away", and a foreign-key action is the wrong place to try.
--
-- What actually protects the history is that **there is no path that deletes a CLIN.**
-- `lib/projects/clins.ts` has `createClin` and no delete, deliberately: a line item leaves a
-- contract by a modification deobligating it to zero, never by a row disappearing (mig 230). So the
-- only caller that reaches these FKs is a project-level cascade, where taking the children along is
-- exactly what is wanted.
--
-- And the MODIFICATION itself survives a CLIN going away — `project_modifications` cascades from
-- the project, not from the CLIN — so "P00001 was executed on 4 May" is never lost. Only the
-- per-field row describing a change to a line item that no longer exists goes with it.
--
-- The lesson is the one this codebase keeps relearning: a claim about how the database behaves has
-- to be MEASURED. Migration 233's header stated its cascade ordering as fact, in a sentence, and
-- the sentence was false.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

ALTER TABLE project_modification_changes
  DROP CONSTRAINT IF EXISTS project_modification_changes_clin_id_fkey;

ALTER TABLE project_modification_changes
  ADD CONSTRAINT project_modification_changes_clin_id_fkey
  FOREIGN KEY (clin_id) REFERENCES project_clins(id) ON DELETE CASCADE;

COMMENT ON COLUMN project_modification_changes.clin_id IS
  'For an amend: which CLIN this change moves. CASCADE — not because the history is disposable, but '
  'because nothing deletes a CLIN except a project cascade (a line item is deobligated to zero by a '
  'modification, never removed), and neither SET NULL nor RESTRICT can survive that cascade. The '
  'modification header outlives it either way.';

-- The same latent defect, in the table it was masking.
ALTER TABLE project_invoice_lines
  DROP CONSTRAINT IF EXISTS project_invoice_lines_clin_id_fkey;

ALTER TABLE project_invoice_lines
  ADD CONSTRAINT project_invoice_lines_clin_id_fkey
  FOREIGN KEY (clin_id) REFERENCES project_clins(id) ON DELETE CASCADE;

COMMENT ON COLUMN project_invoice_lines.clin_id IS
  'The line item this invoice line bills. CASCADE for the same reason as '
  'project_modification_changes.clin_id (mig 234): RESTRICT here blocked deleting the PROJECT, not '
  'merely the CLIN, and had done so undetected since migration 231.';
