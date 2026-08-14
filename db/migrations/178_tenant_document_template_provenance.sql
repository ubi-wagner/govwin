-- Migration 178: standalone-document provenance + atomize-on-download idempotency.
--
-- Phase 2 of the template bridge (docs/TEMPLATE_BRIDGE_DESIGN.md): a tenant
-- instantiates a pristine template CARD (tenant_template_cards, mig 177) into a
-- working tenant_documents row. That card is a SOFT snapshot — it lives in
-- tenant_template_cards, NOT document_templates — so the existing
-- source_template_id column (FK -> document_templates) cannot hold its id.
-- Record the bridge template's stable KEY instead (nullable, no FK).
--
-- atomize-on-download (the "on download is a good trigger, just like the proposal
-- artifacts" behavior): the FIRST time a standalone document is exported, its
-- filled canvas is decomposed into the tenant library (lib/library/foundation.ts
-- decomposeAndIngest). atomized_at makes that once-only + idempotent across
-- re-exports; library_foundation_id links the doc to the minted foundation atom
-- (so a future re-export can redecompose in place instead of duplicating).

ALTER TABLE tenant_documents
    ADD COLUMN IF NOT EXISTS source_template_key   TEXT,
    ADD COLUMN IF NOT EXISTS atomized_at           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS library_foundation_id UUID;

COMMENT ON COLUMN tenant_documents.source_template_key IS
    'Stable template_key of the bridge template card this doc was instantiated from (soft ref; the card is a snapshot, no FK).';
COMMENT ON COLUMN tenant_documents.atomized_at IS
    'When this document was first decomposed into the library on export/download (null = not yet atomized).';
COMMENT ON COLUMN tenant_documents.library_foundation_id IS
    'The library_atoms foundation minted from this document on atomize-on-download.';
