-- Migration 102: atomizer support — creator provenance + source anchor on atoms.
--
-- Every atom is unique in the library and records HOW it was made: creator_kind
-- (admin / AI / collaborator / system / import) + the creating user, and a
-- source_anchor back to the document(s)/objects it was cut from — so an atom can be
-- re-anchored to its origin, and cross-atom composites can anchor to several sources.

ALTER TABLE library_atoms
  ADD COLUMN IF NOT EXISTS creator_kind  TEXT NOT NULL DEFAULT 'admin'
    CHECK (creator_kind IN ('admin','ai','collaborator','system','import')),
  ADD COLUMN IF NOT EXISTS created_by    UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS source_anchor JSONB;   -- [{ sourceAtomId, nodeIds[], region? }] back to the doc/atoms
