-- 017_canvas_templates.sql
--
-- Canvas document system: templates + version history + library outcomes.
-- See docs/CANVAS_DOCUMENT_ARCHITECTURE.md for the full design.
--
-- Purely additive. Idempotent.

-- ============================================================================
-- 1. Document templates catalog
-- ============================================================================

CREATE TABLE IF NOT EXISTS document_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    template_type   TEXT NOT NULL
                      CHECK (template_type IN (
                        'technical_volume','cost_volume','slide_deck',
                        'past_performance','key_personnel','commercialization',
                        'abstract','cover_sheet','supporting_docs','custom'
                      )),
    agency          TEXT,
    program_type    TEXT,
    storage_key     TEXT NOT NULL,
    canvas_preset   JSONB NOT NULL,
    node_count      INTEGER DEFAULT 0,
    is_system       BOOLEAN NOT NULL DEFAULT false,
    tenant_id       UUID REFERENCES tenants(id),
    created_by      UUID REFERENCES users(id),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_templates_type_agency
  ON document_templates (template_type, agency)
  WHERE is_system = true;

CREATE INDEX IF NOT EXISTS idx_templates_tenant
  ON document_templates (tenant_id, template_type)
  WHERE tenant_id IS NOT NULL;

-- ============================================================================
-- 2. Canvas version history (for revert + audit)
-- ============================================================================

CREATE TABLE IF NOT EXISTS canvas_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id      UUID NOT NULL REFERENCES proposal_sections(id) ON DELETE CASCADE,
    version_number  INTEGER NOT NULL,
    content         JSONB NOT NULL,
    snapshot_reason TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (section_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_canvas_versions_section
  ON canvas_versions (section_id, version_number DESC);

-- ============================================================================
-- 3. Library unit outcome tracking (for the learning loop)
-- ============================================================================

ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS outcome TEXT
    CHECK (outcome IN ('pending','awarded','rejected','withdrawn'));

ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS outcome_score REAL DEFAULT 0.5;

ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS original_proposal_id UUID;

ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS original_node_id TEXT;

ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS atom_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_library_units_outcome
  ON library_units (outcome_score DESC)
  WHERE outcome = 'awarded';
