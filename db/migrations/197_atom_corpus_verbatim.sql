-- Migration 197: mark library atoms that are the AGENCY's words, not the tenant's.
--
-- WHY. Atomizing an uploaded solicitation package puts the whole package into the tenant's
-- library — including the agency's own instruction boilerplate, form field labels and submission
-- directions. Retrieval then treats that text as a candidate for drafting, and the failure mode is
-- a proposal that quotes the RFP's own instructions back at the evaluator.
--
-- The first attempt at a fence was structural — exclude anything descended from the reference
-- folder — and it was wrong: it also excluded every uploaded PAST PROPOSAL and every figure
-- harvested from one, which are exactly the tenant's best material (proven live: the tenant's own
-- section scored 4.39 against the fence's 1.06). Reverted.
--
-- The property that actually distinguishes the two is not WHERE the text sits but WHOSE it is, and
-- there is a deterministic test for that: text that appears VERBATIM in the shared solicitation
-- corpus was written by the agency. A tenant's own prose does not appear in a government
-- solicitation. So the mark rides the atom, is computed once at creation from the text itself, and
-- cannot mis-fence a tenant's writing.
--
-- NOT a delete and NOT an archive: the atom stays in the library, stays visible, stays insertable
-- by hand — a builder may well want to paste a required form's exact wording. What it stops being
-- is something the drafter reaches for on its own.

ALTER TABLE library_atoms
  ADD COLUMN IF NOT EXISTS corpus_verbatim BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN library_atoms.corpus_verbatim IS
  'True when this atom''s text appears verbatim in the shared solicitation corpus — i.e. it is the '
  'agency''s words, not the tenant''s. Excluded from automatic draft retrieval; still visible in the '
  'library and still insertable by hand. Computed once at creation (lib/library/corpus-verbatim.ts).';

-- Retrieval reads `WHERE ... AND corpus_verbatim = false`, so index the rows it KEEPS. A partial
-- index on the false side is the small one: the flag is rare by construction.
CREATE INDEX IF NOT EXISTS idx_library_atoms_retrievable
  ON library_atoms (tenant_id, status)
  WHERE corpus_verbatim = false AND archived_at IS NULL;
