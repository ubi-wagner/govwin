-- 238_tenant_opportunity_corpus.sql
--
-- Copy the solicitation INWARD. All of it. The mirror becomes self-sufficient.
--
-- ── WHAT THE MIRROR CARRIED, AND WHAT IT DID NOT ─────────────────────────────────────────────
-- `opportunity-bridge.ts` says of the mirror: *"Tenant cards carry no FK to global opportunities,
-- so a tenant's pipeline is self-sufficient (shard-ready)."* That claim was true only because the
-- card carried so little — 31 keys, mean 1,293 bytes. Ranking therefore read ~296 characters
-- (title + spotlightSummary + description + office) against solicitations averaging **374,514
-- characters** across the seventeen real BAAs and CSOs in docs/. One part in 1,265.
--
-- The alternative considered and rejected was a mirror-anchored JOIN out to
-- `curated_solicitations.full_text_tsv`. It works (proven for all 63 cards) and it is safe (the
-- mirror is the anchor, so RLS is still the fence). It is rejected for a reason beyond isolation:
--
--   THE MASTER IS MUTABLE. An amendment re-shreds `full_text`. A tenant ranking against a joined
--   master would see stored scores move with no bridge version, no card update and no audit —
--   which is the one thing the forward-only bridge exists to prevent. The copy makes the corpus
--   VERSIONED WITH THE CARD, so a score is reproducible from the row that produced it.
--
-- Copy-inward here is not only a fence. It is what makes ranking explainable after the fact.
--
-- ── WHY A TABLE, AND NOT THE CARD JSONB ──────────────────────────────────────────────────────
-- The card jsonb is the DISPLAY payload; it is selected on every list render. Postgres TOASTs a
-- jsonb as one unit, so a megabyte of solicitation text inside `card` would be pulled by every
-- feed query that touches the column. Worse, `opportunity_bridge` is APPEND-ONLY and versioned:
-- corpus-in-card would write another full copy of the document on every republish, forever.
--
-- So the bridge event carries a MANIFEST (ids, types, labels, hashes, page and char counts —
-- kilobytes) and the fan-out copies the bytes master→tenant at apply time. The bridge is the
-- delivery notice; the tenant row is where the copy lands. That is more faithful to copy-inward
-- than putting the corpus in the shared log N times, not less.
--
-- ── AND PER DOCUMENT, NOT ONE CONCATENATED BLOB ──────────────────────────────────────────────
-- `solicitation_documents.extracted_text` already holds text per document, with `document_type`
-- (11 values), `document_label`, `is_primary` and `page_count`. Copying row-for-row:
--
--   · dissolves R2. "Does the topic land at char 20,000 or char 1,040,000?" is only a question
--     because `curated_solicitations.full_text` is a concatenation. Keep the documents apart and
--     there is no order to get wrong — a consumer selects the topic and the component
--     instructions BY TYPE, never by offset.
--   · makes a match explainable: "found in the Navy component instructions, p.31" rather than
--     "found somewhere in a million characters."
--   · gives the drafter the fix for its 18,000-char prefix without a second mechanism (R1).
--
-- This is the pre-award twin of `project_source_documents` (mig 216) — same shape, same fence,
-- one stage earlier. It is deliberately NOT a new spine.
--
-- ── AND `card_tsv` ON THE CARD ITSELF ────────────────────────────────────────────────────────
-- Measured 2026-08-29: NEITHER pre-existing tsvector contains a field the rfp_admin curates.
-- `opportunities.full_text_tsv` is a trigger over five identity columns (mean 25 lexemes) and
-- MISSES `spotlight_summary`, which lives on `curated_solicitations`. Substituting it for the
-- literal matcher loses 3 card-hits and gains 4. A generated tsvector over the CARD covers the
-- curated blurb and every field the bridge carries, on the fenced side, with no join at all.
--
-- ⚠️ `concat_ws` is REJECTED in a generated column ("generation expression is not immutable").
-- The `COALESCE(..) || ' ' || ..` form below is the one that compiles. The obvious spelling fails.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

-- ── 1 · THE CORPUS, IN TENANT SPACE ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenant_opportunity_documents (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id),

  -- Soft references, no FK — the same rule tenant_opportunity_cards follows, and for the same
  -- reason: a tenant's pipeline must not depend on a master row continuing to exist.
  opportunity_id     uuid NOT NULL,
  source_document_id uuid NOT NULL,

  document_type      text NOT NULL,
  document_label     text,
  original_filename  text NOT NULL,
  is_primary         boolean NOT NULL DEFAULT false,

  content_hash       text,
  page_count         integer,
  char_count         integer NOT NULL DEFAULT 0,

  -- The object key. Until the tenant pins, this is the master key served through a tenant-scoped
  -- route that authorises off the CARD's existence — "all foundational uploads must remain
  -- accessible as published by the organization". On pin, opportunity-pin.ts rewrites it to the
  -- tenant's own copy.
  storage_key        text,
  pinned_key         text,

  extracted_text     text,
  text_tsv           tsvector GENERATED ALWAYS AS (
                       to_tsvector('english', COALESCE(extracted_text, ''))
                     ) STORED,

  -- Which bridge version delivered this copy. A corpus that cannot say which version it came from
  -- cannot explain a score computed from it.
  bridge_version     integer NOT NULL DEFAULT 0,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tenant_opp_docs_type_check CHECK (document_type IN (
    'source','rfp','nofo','instructions','amendment','qa','template','supporting','attachment','topic','other'
  )),
  CONSTRAINT tenant_opp_docs_unique UNIQUE (tenant_id, opportunity_id, source_document_id)
);

CREATE INDEX IF NOT EXISTS idx_tod_tenant_opp   ON tenant_opportunity_documents (tenant_id, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_tod_tsv          ON tenant_opportunity_documents USING GIN (text_tsv);
CREATE INDEX IF NOT EXISTS idx_tod_type         ON tenant_opportunity_documents (tenant_id, document_type);

DROP TRIGGER IF EXISTS tod_updated ON tenant_opportunity_documents;
CREATE TRIGGER tod_updated BEFORE UPDATE ON tenant_opportunity_documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE tenant_opportunity_documents IS
  'Mirror-side copy of the solicitation corpus, one row per source document per tenant (mig 238). '
  'Copied inward by the bridge fan-out so ranking reads the whole solicitation without joining the '
  'mutable master — which also makes a stored score reproducible from the bridge_version that '
  'produced it. Per document rather than one concatenation, so a consumer selects by document_type '
  'instead of by character offset. The pre-award twin of project_source_documents.';

COMMENT ON COLUMN tenant_opportunity_documents.source_document_id IS
  'solicitation_documents.id — provenance only, deliberately no FK (copy-inward: the tenant''s '
  'pipeline must not depend on a master row surviving).';

COMMENT ON COLUMN tenant_opportunity_documents.text_tsv IS
  'GENERATED ALWAYS from extracted_text. The ranking corpus. GIN-indexed; maintained by Postgres.';

COMMENT ON COLUMN tenant_opportunity_documents.bridge_version IS
  'The opportunity_bridge version that delivered this copy. Forward-only, like the card''s.';

-- ── 2 · RLS — THE MIRROR IS THE FENCE ────────────────────────────────────────────────────────
-- Same two-layer posture as tenant_opportunity_cards: FORCE, so even the table owner is scoped,
-- and one tenant-equality policy driven by the per-request app.tenant_id GUC.

ALTER TABLE tenant_opportunity_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_opportunity_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tenant_opportunity_documents;
CREATE POLICY tenant_isolation ON tenant_opportunity_documents
  USING      (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_opportunity_documents TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_opportunity_documents TO rfp_agent;

-- ── 3 · THE CARD'S OWN TSVECTOR ──────────────────────────────────────────────────────────────
-- Covers everything the bridge carries in the card, INCLUDING the curated spotlightSummary that
-- neither pre-existing index reaches, and the techFocusAreas/phaseType the bridge now carries.
-- jsonb ->> is immutable and so is the two-argument to_tsvector; concat_ws is not.

ALTER TABLE tenant_opportunity_cards
  ADD COLUMN IF NOT EXISTS card_tsv tsvector GENERATED ALWAYS AS (
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
      COALESCE(card->>'techFocusAreas', '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_toc_card_tsv ON tenant_opportunity_cards USING GIN (card_tsv);

COMMENT ON COLUMN tenant_opportunity_cards.card_tsv IS
  'GENERATED ALWAYS over the card payload (mig 238). The stemmed form of what scoreCard matches '
  'literally, plus the fields the bridge now carries. Includes spotlightSummary, which '
  'opportunities.full_text_tsv structurally cannot (that column lives on curated_solicitations). '
  'techFocusAreas is read with ->> so a jsonb ARRAY renders as its own JSON text — the array '
  'members still tokenise, and the punctuation is discarded by the parser.';
