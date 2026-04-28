-- 021_document_types_and_primary.sql
--
-- Expand solicitation_documents with more document types and a primary flag.
-- Purely additive. Idempotent.

-- Expand the CHECK constraint to include more document types
ALTER TABLE solicitation_documents
  DROP CONSTRAINT IF EXISTS solicitation_documents_document_type_check;
ALTER TABLE solicitation_documents
  ADD CONSTRAINT solicitation_documents_document_type_check
  CHECK (document_type IN (
    'source','rfp','nofo','instructions','amendment','qa',
    'template','supporting','attachment','other'
  ));

-- Primary flag — one document per solicitation should be the main RFP/BAA/NOFO
ALTER TABLE solicitation_documents
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

-- Optional human-readable label for the document
ALTER TABLE solicitation_documents
  ADD COLUMN IF NOT EXISTS document_label TEXT;
