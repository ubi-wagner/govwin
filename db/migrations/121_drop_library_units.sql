-- 121_drop_library_units.sql
--
-- P0-1 library cutover — final drop. The legacy library_units spine is fully retired:
-- every live read/write across frontend + pipeline was repointed to the canonical
-- library_atoms (verified — zero `FROM|INTO|UPDATE|JOIN library_units` in prod code), the
-- section-accept dual-write was removed, and the dead proposal-harvest.ts module was deleted.
-- library_units has 0 rows. Drop it and its satellites in FK order (children first).
--
-- Satellites (all FK → library_units): library_harvest_log, library_atom_outcomes (a
-- misleadingly-named library_units satellite — its writer was removed), library_unit_shares
-- (ON DELETE CASCADE). supporting_documents.library_unit_id is an FK COLUMN (the table
-- survives — drop just the column). library_units' self-FK parent_unit_id drops with it.
-- Idempotent.

-- 1. Satellite tables that reference library_units.
DROP TABLE IF EXISTS library_harvest_log;
DROP TABLE IF EXISTS library_atom_outcomes;
DROP TABLE IF EXISTS library_unit_shares;

-- 2. The FK COLUMN on proposal_supporting_docs (keep the table; drop the column + its
--    constraint proposal_supporting_docs_library_unit_id_fkey). No code reads it.
ALTER TABLE proposal_supporting_docs DROP COLUMN IF EXISTS library_unit_id;

-- 3. The table itself (removes the parent_unit_id self-FK, the library_updated trigger,
--    and every idx_library_* index).
DROP TABLE IF EXISTS library_units;
