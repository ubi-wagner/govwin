-- 012_volumes_documents.sql
--
-- Phase 1 extension: richer compliance model supporting DSIP-style
-- multi-volume proposal structures where each volume can require
-- multiple artifacts (Word docs, slide decks, spreadsheets), each
-- with its own compliance matrix.
--
-- Hierarchy:
--   curated_solicitations
--     ├─ solicitation_documents  (source files: RFP PDF, amendments, Q&A)
--     ├─ solicitation_volumes    (required volumes for the proposal response, 1-N)
--         └─ volume_required_items  (artifacts within each volume, each with compliance)
--
-- The existing solicitation_compliance table stays as the "top-level"
-- aggregate view — per-volume/per-item details live in the new tables.
--
-- Purely additive. Idempotent via IF NOT EXISTS.

-- ============================================================================
-- 1. solicitation_documents — actual files attached to this solicitation
-- ============================================================================

CREATE TABLE IF NOT EXISTS solicitation_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id   UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,

    document_type     TEXT NOT NULL DEFAULT 'source'
                        CHECK (document_type IN ('source','amendment','qa','template','attachment','other')),
    original_filename TEXT NOT NULL,
    storage_key       TEXT NOT NULL UNIQUE,
    file_size         BIGINT,
    content_type      TEXT,
    page_count        INTEGER,

    -- Populated by the shredder after pymupdf4llm extraction
    extracted_text    TEXT,
    extracted_at      TIMESTAMPTZ,

    uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sol_docs_solicitation
  ON solicitation_documents (solicitation_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_sol_docs_needs_extraction
  ON solicitation_documents (solicitation_id)
  WHERE extracted_at IS NULL;

-- ============================================================================
-- 2. solicitation_volumes — curated response-structure (1-N per solicitation)
-- ============================================================================
-- Typically DSIP has 1-5 volumes but the model is flexible. The expert
-- defines volumes based on what the RFP requires.

CREATE TABLE IF NOT EXISTS solicitation_volumes (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id       UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,

    volume_number         INTEGER NOT NULL,
    volume_name           TEXT NOT NULL,
    volume_format         TEXT DEFAULT 'custom'
                            CHECK (volume_format IN ('dsip_standard','l_and_m','custom')),
    description           TEXT,
    special_requirements  TEXT[] NOT NULL DEFAULT '{}',

    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,

    created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (solicitation_id, volume_number)
);

CREATE INDEX IF NOT EXISTS idx_sol_volumes_solicitation
  ON solicitation_volumes (solicitation_id, volume_number ASC);

-- ============================================================================
-- 3. volume_required_items — artifacts within each volume, each with compliance
-- ============================================================================

CREATE TABLE IF NOT EXISTS volume_required_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    volume_id             UUID NOT NULL REFERENCES solicitation_volumes(id) ON DELETE CASCADE,

    item_number           INTEGER NOT NULL,
    item_name             TEXT NOT NULL,
    item_type             TEXT NOT NULL DEFAULT 'word_doc'
                            CHECK (item_type IN (
                              'word_doc','slide_deck','spreadsheet','pdf','text',
                              'form_sf424','form_sbir_certs','form_other','other'
                            )),
    required              BOOLEAN NOT NULL DEFAULT true,

    -- Formatting requirements
    page_limit            INTEGER,
    slide_limit           INTEGER,
    font_family           TEXT,
    font_size             TEXT,
    margins               TEXT,
    line_spacing          TEXT,
    header_format         TEXT,
    footer_format         TEXT,

    -- Content requirements
    required_sections     JSONB NOT NULL DEFAULT '[]'::jsonb,
    format_rules          JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Expert-added arbitrary compliance fields (TABA gate, ITAR cert, etc.)
    custom_fields         JSONB NOT NULL DEFAULT '{}'::jsonb,

    -- Provenance: which source text from the RFP supports this requirement?
    source_excerpts       JSONB NOT NULL DEFAULT '[]'::jsonb,

    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,

    verified_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at           TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    UNIQUE (volume_id, item_number)
);

CREATE INDEX IF NOT EXISTS idx_vol_items_volume
  ON volume_required_items (volume_id, item_number ASC);

-- ============================================================================
-- 4. updated_at trigger helpers (reusable)
-- ============================================================================

CREATE OR REPLACE FUNCTION _touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sol_docs_touch_updated_at') THEN
    CREATE TRIGGER sol_docs_touch_updated_at
      BEFORE UPDATE ON solicitation_documents
      FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sol_volumes_touch_updated_at') THEN
    CREATE TRIGGER sol_volumes_touch_updated_at
      BEFORE UPDATE ON solicitation_volumes
      FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'vol_items_touch_updated_at') THEN
    CREATE TRIGGER vol_items_touch_updated_at
      BEFORE UPDATE ON volume_required_items
      FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();
  END IF;
END $$;
