-- 122_topic_origin_document.sql
--
-- The missing file↔opportunity link for the per-topic-file ingest path.
--
-- "Topics ARE opportunities" (013): a topic is an `opportunities` row with
-- solicitation_id → its umbrella + topic_number. Until now, a topic file
-- (solicitation_documents.document_type='topic', 015) and the topic
-- opportunity it grounds were correlated only by the loose `topic_number`
-- string — there was no FK. That gap blocked the "upload N topic files →
-- N topic opportunities" flow from recording provenance (which file each
-- OPP was born from).
--
-- This adds the forward link opportunities.origin_document_id →
-- solicitation_documents(id). NULL for topics extracted from umbrella text
-- or added manually; set when a topic OPP is ingested from its own file.
--
-- Purely additive. Idempotent via IF NOT EXISTS.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS origin_document_id UUID
    REFERENCES solicitation_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_opps_origin_document
  ON opportunities (origin_document_id)
  WHERE origin_document_id IS NOT NULL;

COMMENT ON COLUMN opportunities.origin_document_id IS
  'The solicitation_documents(document_type=topic) row this topic opportunity was ingested from (per-topic-file upload). NULL for umbrella-text extraction or manual add.';
