-- Migration 110: tenant_documents — standalone canvas documents (Tier 2, #3/#4).
--
-- The portal could only enter the canvas via a provisioned proposal SECTION
-- (opportunity-bound, compliance-matrixed). This adds the founder's "quick
-- document creation from template and library … a super simple 1-page flier or
-- the whole proposal" surface: a tenant authors a standalone document — from a
-- `document_templates` skeleton or from a blank preset — in the SAME canvas
-- editor, saves it (optimistic-locked), and exports it (docx/pptx/xlsx/pdf).
--
-- Distinct from:
--   * proposal_sections — a volume section bound to an opportunity + matrix.
--   * document_templates — the reusable SKELETON a document can start from.
--   * library_atoms       — reusable CONTENT dropped into a document.
--
-- `canvas` holds a full CanvasDocument (v1 flat nodes or v2 section layer; both
-- render + export). `version` is the optimistic-lock counter the save route
-- compare-and-swaps on. `source_template_id` records the skeleton it began from.

CREATE TABLE IF NOT EXISTS tenant_documents (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title              TEXT NOT NULL,
    doc_type           TEXT NOT NULL DEFAULT 'custom'
                         CHECK (doc_type IN (
                           'technical_volume','cost_volume','slide_deck',
                           'past_performance','key_personnel','commercialization',
                           'abstract','cover_sheet','supporting_docs','custom'
                         )),
    status             TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','final')),
    canvas             JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_template_id UUID REFERENCES document_templates(id),
    node_count         INTEGER NOT NULL DEFAULT 0,
    version            INTEGER NOT NULL DEFAULT 1,
    created_by         UUID REFERENCES users(id),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Portal listing is "my tenant's documents, most-recent first".
CREATE INDEX IF NOT EXISTS idx_tenant_documents_tenant
    ON tenant_documents (tenant_id, updated_at DESC);
