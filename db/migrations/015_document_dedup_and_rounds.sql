-- 015_document_dedup_and_rounds.sql
--
-- Global file dedup via content_hash on solicitation_documents.
-- Round/release tracking on curated_solicitations for multi-round
-- solicitations (XTech2026 R1-R4, DoD SBIR 25.D R1-R12, etc.).
--
-- Purely additive. Idempotent.

-- ============================================================================
-- 1. Content hash for global dedup
-- ============================================================================

ALTER TABLE solicitation_documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Global unique index on content_hash so the same physical file
-- cannot be uploaded twice across ANY solicitation without an
-- explicit admin override.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sol_docs_content_hash_unique
  ON solicitation_documents (content_hash)
  WHERE content_hash IS NOT NULL;

-- ============================================================================
-- 2. Round/release tracking on solicitations
-- ============================================================================

ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS round_number INTEGER;

ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS round_label TEXT;

-- A solicitation can have multiple rounds (each adds topics).
-- round_number is the numeric (1-12), round_label is the display
-- ("Release 12", "Round 4", "FY2026 Q2"). Both optional — single-
-- round solicitations leave these null.

-- ============================================================================
-- 3. Topic document_type: add 'topic' to the CHECK constraint
-- ============================================================================
-- Topics extracted from the umbrella BAA or uploaded individually
-- get stored as document_type='topic' so we can distinguish them
-- from the source RFP, amendments, Q&A, etc.

DO $$
DECLARE
  conname_found TEXT;
  condef TEXT;
BEGIN
  SELECT conname, pg_get_constraintdef(oid) INTO conname_found, condef
  FROM pg_constraint
  WHERE conrelid = 'solicitation_documents'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%document_type%'
  LIMIT 1;

  IF conname_found IS NULL THEN
    ALTER TABLE solicitation_documents
      ADD CONSTRAINT solicitation_documents_document_type_check
      CHECK (document_type IN (
        'source','amendment','qa','template','attachment','topic','other'
      ));
  ELSIF condef NOT LIKE '%topic%' THEN
    EXECUTE format('ALTER TABLE solicitation_documents DROP CONSTRAINT %I', conname_found);
    ALTER TABLE solicitation_documents
      ADD CONSTRAINT solicitation_documents_document_type_check
      CHECK (document_type IN (
        'source','amendment','qa','template','attachment','topic','other'
      ));
  END IF;
END $$;
