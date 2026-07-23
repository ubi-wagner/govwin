-- 132_foundation_artifact_grains.sql
--
-- The foundation-artifact containment model (docs/LIBRARY_AND_VAULTS_DESIGN.md §1):
-- a created canvas is a FOUNDATION ARTIFACT — a container/scaffold — that decomposes
-- into the real atoms at three grains. Name each level as a first-class grain:
--
--     foundation ⊃ section ⊃ group ⊃ primitive     (+ reference, unchanged)
--
-- 'foundation' = the whole canvas (doc/ppt/pdf/sheet); 'section' = a CanvasSection;
-- 'group' = a group within a section; 'primitive' = a leaf node. Members are wired
-- via the existing atom_members table (container_atom_id → member_atom_id), and
-- createAtom now records members for foundation/section as well as group.
--
-- Widen the grain CHECK; leave existing rows (primitive/group/reference) valid.

ALTER TABLE library_atoms DROP CONSTRAINT IF EXISTS library_atoms_grain_check;
ALTER TABLE library_atoms ADD CONSTRAINT library_atoms_grain_check
  CHECK (grain = ANY (ARRAY['foundation'::text, 'section'::text, 'group'::text, 'primitive'::text, 'reference'::text]));
