-- Migration 047: Supporting documents — required/optional files from the compliance matrix
-- Seeded at proposal creation from solicitation_compliance.required_documents

CREATE TABLE IF NOT EXISTS proposal_supporting_docs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),

    -- What's required (from compliance matrix)
    requirement_label TEXT NOT NULL,
    requirement_source TEXT, -- e.g., "Section L, para 4.2.1"
    category TEXT NOT NULL DEFAULT 'supporting_document'
        CHECK (category IN ('supporting_document', 'proposal_input', 'other')),
    is_required BOOLEAN NOT NULL DEFAULT true,

    -- Upload tracking
    storage_key TEXT, -- S3 key when uploaded
    original_filename TEXT,
    file_size INTEGER,
    content_type TEXT,

    -- Status workflow
    status TEXT NOT NULL DEFAULT 'missing'
        CHECK (status IN ('missing', 'uploaded', 'reviewed', 'approved', 'waived')),

    -- Actors
    uploaded_by UUID REFERENCES users(id),
    uploaded_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id),
    reviewed_at TIMESTAMPTZ,
    notes TEXT,

    -- Atomization link (if this doc was atomized into library)
    library_unit_id UUID REFERENCES library_units(id),

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_psd_proposal ON proposal_supporting_docs(proposal_id);
CREATE INDEX IF NOT EXISTS idx_psd_tenant ON proposal_supporting_docs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_psd_status ON proposal_supporting_docs(status) WHERE status != 'approved';
