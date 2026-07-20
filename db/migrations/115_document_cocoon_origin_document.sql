-- 115_document_cocoon_origin_document.sql
--
-- #18 branch-and-promote reuse loop. When a customer REGENs from a templified past
-- proposal, the seminal atoms are COPIED into a working document_cocoon (source='regen')
-- whose atoms are draft working copies with derived_from lineage back to the seminal ones.
-- On FULL LOCK for download, those working copies are promoted to new FOUNDATION atoms
-- (non-destructive; the seminal originals are untouched). This column ties a working
-- cocoon (and thus its working atoms) to the tenant_document it backs, so lock can find
-- and promote exactly that document's working set.
--
-- Idempotent.

ALTER TABLE document_cocoons
  ADD COLUMN IF NOT EXISTS origin_document_id uuid REFERENCES tenant_documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_document_cocoons_origin_document
  ON document_cocoons (origin_document_id) WHERE origin_document_id IS NOT NULL;
