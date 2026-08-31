-- 239_curated_ranking_corpus.sql
--
-- The ranking corpus is the CURATED RECORD, not the solicitation.
--
-- ── WHAT MIGRATION 238 GOT WRONG ─────────────────────────────────────────────────────────────
-- 238 copied every source document's text into every tenant's mirror and fed it to the scorer as a
-- `ts_rank` factor. It was measured, it shipped, and the measurement was of the wrong thing.
--
-- Measured on the same box, one 330-page general BAA, `ts_rank` per term:
--
--     manufacturing  0.0827        quantum      0.0827
--     concrete       0.0608        agriculture  0.0608
--     robotics       0.0608        submarine    0.0608
--
-- A general solicitation MENTIONS EVERYTHING ONCE, so the rank is identical for terms the document
-- has nothing to do with. `agriculture` scores exactly what `concrete` scores. The normalization
-- then divided by the best rank in the pass, turning "appears once" into 100 — which is why four
-- unrelated buckets all scored one card at ceiling and it read like a win.
--
-- The corpus factor was a PRESENCE TEST ON BOILERPLATE. A 330-page BAA is mostly FAR clauses,
-- registration mechanics and other components' instructions; matching against it measures document
-- length, not relevance.
--
-- ── WHAT RANKS INSTEAD ───────────────────────────────────────────────────────────────────────
-- The artifacts a curator PRODUCES while reading the document, which are the distilled judgement
-- the raw text is not:
--
--     spotlight_summary · expert_notes · tech_focus_areas · phase_type    already on the card
--     volume names + required-item names ("volumes and skeletons")        added here
--     submission format + page limits                                    already summarized
--     the admin's HIGHLIGHTS                                             this migration
--
-- Those are small, they are specific, and every one of them exists because a person decided it
-- mattered. That is what a ranking should match.
--
-- ── AND THE DOCUMENTS BECOME REFERENCE, PINNED ───────────────────────────────────────────────
-- `tenant_opportunity_documents` (mig 238) stays, and stays FORCE-RLS with its tsvector — it is how
-- a tenant reads and searches the solicitation they pinned. What changes is WHEN it is populated:
-- at PIN, not at fan-out. The card keeps the manifest, so a tenant can see what exists before
-- pinning; the bytes arrive when they ask for them.
--
-- That also removes the cost that had no payoff: 21 MB per opportunity per seven tenants, copied
-- for every holder whether or not any of them ever opened it.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

-- ── 1 · A HIGHLIGHT CARRIES ITS TEXT ─────────────────────────────────────────────────────────
-- `solicitation_annotations` stored `source_location {page, offset, length}` and no excerpt. An
-- anchor alone is useless anywhere the document is not open: a tenant who has not pinned has no
-- local copy to resolve it against, so the highlight renders empty for exactly the customer it
-- exists to inform — and a ranker cannot match it at all, because there is nothing to match.

ALTER TABLE solicitation_annotations
  ADD COLUMN IF NOT EXISTS excerpt text;

COMMENT ON COLUMN solicitation_annotations.excerpt IS
  'The selected text of the highlight (mig 239), capped at 2,000 by the tool. The anchor in '
  'source_location stays alongside it and becomes live once a tenant pins the document. Carried '
  'onto the mirror card, where it is matchable text and a visible "highlighted by our analysts" '
  'panel — the curator''s judgement, which is what ranking reads instead of the raw solicitation.';

-- ── 2 · THE CARD'S TSVECTOR COVERS THE CURATED RECORD ────────────────────────────────────────
-- Rebuilt to include the volumes, required items and highlights the bridge now carries. Dropped and
-- recreated because a GENERATED expression cannot be altered in place.
--
-- ⚠️ `concat_ws` is REJECTED here ("generation expression is not immutable"); the
-- COALESCE(..) || ' ' || .. form is the one that compiles. Same trap as mig 238.

DROP INDEX IF EXISTS idx_toc_card_tsv;
ALTER TABLE tenant_opportunity_cards DROP COLUMN IF EXISTS card_tsv;

ALTER TABLE tenant_opportunity_cards
  ADD COLUMN card_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('english',
      COALESCE(card->>'title', '')             || ' ' ||
      COALESCE(card->>'spotlightSummary', '')  || ' ' ||
      COALESCE(card->>'description', '')       || ' ' ||
      COALESCE(card->>'expertNotes', '')       || ' ' ||
      COALESCE(card->>'office', '')            || ' ' ||
      COALESCE(card->>'orgUnit', '')           || ' ' ||
      COALESCE(card->>'agency', '')            || ' ' ||
      COALESCE(card->>'programType', '')       || ' ' ||
      COALESCE(card->>'phaseType', '')         || ' ' ||
      COALESCE(card->>'topicNumber', '')       || ' ' ||
      COALESCE(card->>'topicBranch', '')       || ' ' ||
      COALESCE(card->>'techFocusAreas', '')    || ' ' ||
      -- The curated build-out: what the admin decided this proposal is MADE OF.
      COALESCE(card->>'volumes', '')           || ' ' ||
      COALESCE(card->>'requiredItems', '')     || ' ' ||
      -- And what they marked while reading it.
      COALESCE(card->>'highlights', '')
    )
  ) STORED;

CREATE INDEX idx_toc_card_tsv ON tenant_opportunity_cards USING GIN (card_tsv);

COMMENT ON COLUMN tenant_opportunity_cards.card_tsv IS
  'GENERATED ALWAYS over the card payload (mig 238, widened mig 239 to the curated build-out and '
  'the admin''s highlights). The stemmed form of what scoreCard matches literally. Reads the '
  'CURATED record, never the solicitation text — a general BAA mentions every term once, so '
  'ranking against it measures document length rather than relevance (see the header of mig 239).';

-- ── 3 · THE CORPUS IS REFERENCE NOW, AND SAYS SO ─────────────────────────────────────────────

COMMENT ON TABLE tenant_opportunity_documents IS
  'The tenant''s own copy of the solicitation documents, one row per source document (mig 238), '
  'populated AT PIN rather than at fan-out (mig 239). REFERENCE AND SEARCH, not a ranking input: '
  'the tenant reads and searches what they pinned. The card carries the manifest so they can see '
  'what exists before pinning. FORCE-RLS; text_tsv is GIN-indexed for their search, not for scoring.';

COMMENT ON COLUMN tenant_opportunity_documents.bridge_version IS
  'The opportunity_bridge version whose manifest this copy was taken against. Forward-only, so a '
  'resync after an amendment replaces the text rather than layering it.';
