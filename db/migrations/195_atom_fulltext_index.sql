-- 195 · Lexical relevance for library retrieval
--
-- WHY. `selectForSection` ranked atoms by: scope tag filter → context-tag count → (gated) vector
-- cosine → outcome score → usage → created_at. With the semantic engine off — which is the
-- DEFAULT, and the state every deployment without VOYAGE_API_KEY runs in — nothing in that list
-- looks at the section's own words. On a real tenant library every candidate carries the same
-- context tags and the same untouched outcome/usage defaults, so the ordering collapsed to
-- `created_at DESC`: the newest N atoms, identically, for EVERY section of the proposal.
--
-- Measured on the Immobileyes library (224 atoms): four different technical sections — "Phase I
-- Technical Objectives", "Phase I Statement of Work", "Anticipated Performance Improvements…",
-- "Identification and Significance of the Problem" — each received the SAME six atoms, all of them
-- fraud-waste-and-abuse boilerplate harvested from a DSIP instruction page, and every drafted
-- section of the volume therefore opened with the same sentence about the False Claims Act.
--
-- This index backs a Postgres full-text rank axis in the selector, so retrieval discriminates by
-- the atom's own text with no API key, no extension, and no embedding backfill.
--
-- English config chosen deliberately: stemming makes "objective"/"objectives" and
-- "commercialize"/"commercialization" the same lexeme, which is exactly the match a section title
-- needs against body prose. Title is weighted 'A' and body 'B' so an atom NAMED for the topic
-- outranks one that merely mentions it.

CREATE INDEX IF NOT EXISTS idx_library_atoms_fts
  ON library_atoms
  USING gin ((
    setweight(to_tsvector('english', coalesce(title, '')), 'A')
    || setweight(to_tsvector('english', coalesce(content, '')), 'B')
  ));

-- Trigram support for the short, un-stemmable fragments a section title often is (a topic
-- designator, an acronym, a product name). pg_trgm is already required by the search surfaces;
-- IF NOT EXISTS keeps this idempotent where it is present.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
