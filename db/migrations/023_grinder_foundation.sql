-- =============================================================================
-- Migration 023 — Grinder Foundation
-- Proposal build pipeline: library units, RFP templates, proposals, sections,
-- version history, personnel assignments, and export tracking.
-- From pinned opportunity to full SBIR/STTR proposal assembly.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. library_units — Atomic content library with vector embeddings
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_units (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    content             TEXT NOT NULL,
    content_type        TEXT NOT NULL DEFAULT 'text',  -- text, table, image_ref, code
    category            TEXT NOT NULL,  -- bio, facility, tech_approach, past_performance, management, commercialization, budget_justification, equipment, data_management, broader_impact, general
    subcategory         TEXT,  -- e.g. 'pi_bio', 'co_pi_bio', 'lab_facility', 'field_site'
    title               TEXT,  -- human-readable label
    embedding           vector(1536),  -- pgvector column for semantic search
    source_upload_id    UUID REFERENCES tenant_uploads(id) ON DELETE SET NULL,
    source_record_type  TEXT,  -- 'past_performance', 'capability', 'personnel', 'boilerplate', 'partner', 'proposal'
    source_record_id    UUID,
    context_tags        JSONB DEFAULT '{}',  -- AI-generated: {"expertise": ["AI", "drones"], "agency_fit": ["DoD", "AFRL"]}
    confidence_score    NUMERIC(4,2),  -- 0.00-1.00, AI extraction confidence
    status              TEXT NOT NULL DEFAULT 'draft',  -- draft, approved, archived, rejected
    word_count          INT,
    char_count          INT,
    version             INT DEFAULT 1,
    parent_unit_id      UUID REFERENCES library_units(id) ON DELETE SET NULL,  -- refinement chain
    approved_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
    approved_at         TIMESTAMPTZ,
    last_used_at        TIMESTAMPTZ,
    usage_count         INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for library_units
CREATE INDEX IF NOT EXISTS idx_library_units_tenant_approved
    ON library_units (tenant_id, status) WHERE status = 'approved';

CREATE INDEX IF NOT EXISTS idx_library_units_tenant_category
    ON library_units (tenant_id, category);

CREATE INDEX IF NOT EXISTS idx_library_units_embedding
    ON library_units USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_library_units_source_upload
    ON library_units (source_upload_id);

CREATE INDEX IF NOT EXISTS idx_library_units_source_record
    ON library_units (source_record_type, source_record_id);

CREATE INDEX IF NOT EXISTS idx_library_units_parent
    ON library_units (parent_unit_id) WHERE parent_unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_library_units_context_tags
    ON library_units USING gin (context_tags);

CREATE INDEX IF NOT EXISTS idx_library_units_tenant_last_used
    ON library_units (tenant_id, last_used_at DESC);

-- Trigger
CREATE TRIGGER trg_library_units_updated_at
    BEFORE UPDATE ON library_units
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 2. library_unit_images — Extracted images linked to atomic units
-- =============================================================================

CREATE TABLE IF NOT EXISTS library_unit_images (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    unit_id             UUID NOT NULL REFERENCES library_units(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    image_path          TEXT NOT NULL,  -- Railway volume path
    storage_backend     TEXT DEFAULT 'local',
    mime_type           TEXT,
    width_px            INT,
    height_px           INT,
    file_size_bytes     BIGINT,
    alt_text            TEXT,
    caption             TEXT,
    sort_order          INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_library_unit_images_unit
    ON library_unit_images (unit_id);

-- =============================================================================
-- 3. rfp_template_library — Reusable agency-specific templates (system-wide)
-- =============================================================================

CREATE TABLE IF NOT EXISTS rfp_template_library (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agency              TEXT NOT NULL,  -- 'DoD', 'NSF', 'NIH', 'DOE', 'NASA', 'DHS'
    program_type        TEXT NOT NULL,  -- 'SBIR_Phase_I', 'SBIR_Phase_II', 'STTR_Phase_I', 'STTR_Phase_II', 'BAA', 'Challenge'
    sub_agency          TEXT,  -- 'AFRL', 'DARPA', 'SOFWERX', 'Army', 'Navy'
    template_name       TEXT NOT NULL,
    description         TEXT,
    sections            JSONB NOT NULL,  -- [{key, title, page_limit, required, instructions, subsections, evaluation_weight}]
    constraints         JSONB NOT NULL DEFAULT '{}',  -- {font, font_size, margins, total_pages, line_spacing, header_footer}
    submission_format   JSONB DEFAULT '{}',  -- {formats_accepted: ['pdf'], upload_portal: 'DSIP', file_name_convention: '...'}
    evaluation_criteria JSONB DEFAULT '{}',  -- [{criterion, weight, description}]
    common_errors       JSONB DEFAULT '[]',  -- Known gotchas for this template type
    version             INT DEFAULT 1,
    usage_count         INT DEFAULT 0,
    accuracy_score      NUMERIC(4,2),  -- How often users accept without corrections
    created_by          TEXT DEFAULT 'system',
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agency, program_type, sub_agency, version)
);

CREATE INDEX IF NOT EXISTS idx_rfp_template_library_agency_program
    ON rfp_template_library (agency, program_type) WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_rfp_template_library_usage
    ON rfp_template_library (usage_count DESC);

-- Trigger
CREATE TRIGGER trg_rfp_template_library_updated_at
    BEFORE UPDATE ON rfp_template_library
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 4. rfp_templates — Per-opportunity parsed RFP structure
-- =============================================================================

CREATE TABLE IF NOT EXISTS rfp_templates (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    opportunity_id      UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    base_template_id    UUID REFERENCES rfp_template_library(id) ON DELETE SET NULL,
    template_name       TEXT NOT NULL,
    sections            JSONB NOT NULL,  -- [{key, title, page_limit, required, instructions, subsections}]
    constraints         JSONB NOT NULL DEFAULT '{}',
    submission_format   JSONB DEFAULT '{}',
    evaluation_criteria JSONB DEFAULT '{}',
    source              TEXT NOT NULL DEFAULT 'library',  -- 'library', 'ai_extracted', 'manual', 'hybrid'
    status              TEXT NOT NULL DEFAULT 'draft',  -- draft, accepted, locked, superseded
    user_corrections    JSONB DEFAULT '[]',  -- [{section_key, field, old_value, new_value, reason}]
    accepted_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
    accepted_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rfp_templates_tenant_opportunity
    ON rfp_templates (tenant_id, opportunity_id);

CREATE INDEX IF NOT EXISTS idx_rfp_templates_base_template
    ON rfp_templates (base_template_id);

CREATE INDEX IF NOT EXISTS idx_rfp_templates_status
    ON rfp_templates (status);

-- Trigger
CREATE TRIGGER trg_rfp_templates_updated_at
    BEFORE UPDATE ON rfp_templates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 5. proposals — Core proposal entity
-- =============================================================================

CREATE TABLE IF NOT EXISTS proposals (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    opportunity_id      UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    rfp_template_id     UUID REFERENCES rfp_templates(id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    status              TEXT NOT NULL DEFAULT 'draft',  -- draft, assembly, review, final_review, complete, exported, archived
    page_limit          NUMERIC(5,2),  -- Total from template constraints
    current_page_est    NUMERIC(5,2) DEFAULT 0,
    section_count       INT DEFAULT 0,
    sections_populated  INT DEFAULT 0,
    sections_approved   INT DEFAULT 0,
    completion_pct      NUMERIC(5,2) DEFAULT 0,
    created_by          TEXT NOT NULL REFERENCES users(id),
    locked_by           TEXT REFERENCES users(id) ON DELETE SET NULL,
    locked_at           TIMESTAMPTZ,
    submitted_at        TIMESTAMPTZ,
    outcome             TEXT,  -- won, lost, no_bid, pending, withdrawn
    outcome_notes       TEXT,
    score_received      NUMERIC(5,2),
    debrief_notes       TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposals_tenant_status
    ON proposals (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_proposals_tenant_opportunity
    ON proposals (tenant_id, opportunity_id);

CREATE INDEX IF NOT EXISTS idx_proposals_created_by
    ON proposals (created_by);

CREATE INDEX IF NOT EXISTS idx_proposals_active_status
    ON proposals (status) WHERE status NOT IN ('archived');

-- Trigger
CREATE TRIGGER trg_proposals_updated_at
    BEFORE UPDATE ON proposals
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 6. proposal_sections — Per-section content + status
-- =============================================================================

CREATE TABLE IF NOT EXISTS proposal_sections (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id         UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    section_key         TEXT NOT NULL,
    title               TEXT NOT NULL,
    sort_order          INT NOT NULL DEFAULT 0,
    page_limit          NUMERIC(5,2),  -- .25 page precision
    required            BOOLEAN DEFAULT TRUE,
    instructions        TEXT,  -- From the RFP template
    content_draft       TEXT,  -- Current working text (markdown)
    content_final       TEXT,  -- Locked final text
    status              TEXT NOT NULL DEFAULT 'empty',  -- empty, ai_populated, user_edited, approved, locked, needs_revision
    ai_confidence       NUMERIC(4,2),  -- How well the reanimator matched
    ai_match_summary    TEXT,  -- "Used 3 library units: Bio for Dr. Smith, AFRL Past Perf, AI Capability"
    word_count          INT DEFAULT 0,
    char_count          INT DEFAULT 0,
    est_page_count      NUMERIC(5,2) DEFAULT 0,
    page_status         TEXT DEFAULT 'unknown',  -- under, within, over
    refinement_count    INT DEFAULT 0,  -- How many AI passes
    reviewed_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(proposal_id, section_key)
);

CREATE INDEX IF NOT EXISTS idx_proposal_sections_proposal_order
    ON proposal_sections (proposal_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_proposal_sections_active_status
    ON proposal_sections (status) WHERE status != 'locked';

-- Trigger
CREATE TRIGGER trg_proposal_sections_updated_at
    BEFORE UPDATE ON proposal_sections
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 7. proposal_section_history — Immutable version history
-- =============================================================================

CREATE TABLE IF NOT EXISTS proposal_section_history (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id          UUID NOT NULL REFERENCES proposal_sections(id) ON DELETE CASCADE,
    proposal_id         UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    content             TEXT NOT NULL,
    change_type         TEXT NOT NULL,  -- 'ai_populated', 'user_edit', 'ai_refined', 'swap_unit', 'manual_paste', 'revert'
    changed_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
    change_summary      TEXT,  -- "Replaced Bio A with Bio B", "AI refined to 0.5 pages"
    word_count          INT,
    est_page_count      NUMERIC(5,2),
    metadata            JSONB DEFAULT '{}',  -- {units_used: [...], refinement_prompt: '...'}
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposal_section_history_section_time
    ON proposal_section_history (section_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_proposal_section_history_proposal
    ON proposal_section_history (proposal_id);

-- =============================================================================
-- 8. proposal_section_units — Junction: library atoms used in sections
-- =============================================================================

CREATE TABLE IF NOT EXISTS proposal_section_units (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    section_id          UUID NOT NULL REFERENCES proposal_sections(id) ON DELETE CASCADE,
    unit_id             UUID NOT NULL REFERENCES library_units(id) ON DELETE CASCADE,
    proposal_id         UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    sort_order          INT DEFAULT 0,
    usage_type          TEXT DEFAULT 'primary',  -- primary, supporting, reference
    ai_selected         BOOLEAN DEFAULT TRUE,  -- Was this AI-recommended or user-picked?
    confidence_score    NUMERIC(4,2),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(section_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_proposal_section_units_unit
    ON proposal_section_units (unit_id);

CREATE INDEX IF NOT EXISTS idx_proposal_section_units_proposal
    ON proposal_section_units (proposal_id);

-- =============================================================================
-- 9. proposal_personnel — People assigned to proposal sections
-- =============================================================================

CREATE TABLE IF NOT EXISTS proposal_personnel (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id         UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    personnel_id        UUID NOT NULL REFERENCES key_personnel(id) ON DELETE CASCADE,
    section_id          UUID REFERENCES proposal_sections(id) ON DELETE SET NULL,
    role_in_proposal    TEXT NOT NULL,  -- 'PI', 'Co-PI', 'Key Personnel', 'Consultant', 'Subcontractor Lead'
    effort_percentage   NUMERIC(5,2),  -- % of time on this project
    sort_order          INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(proposal_id, personnel_id)
);

CREATE INDEX IF NOT EXISTS idx_proposal_personnel_proposal
    ON proposal_personnel (proposal_id);

CREATE INDEX IF NOT EXISTS idx_proposal_personnel_personnel
    ON proposal_personnel (personnel_id);

-- =============================================================================
-- 10. proposal_exports — Download/export tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS proposal_exports (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proposal_id         UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    format              TEXT NOT NULL,  -- 'pdf', 'docx', 'pptx', 'markdown'
    file_path           TEXT,  -- Railway volume path
    file_size_bytes     BIGINT,
    storage_backend     TEXT DEFAULT 'local',
    exported_by         TEXT NOT NULL REFERENCES users(id),
    version_label       TEXT,  -- "Draft 1", "Final", "Submission"
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposal_exports_proposal
    ON proposal_exports (proposal_id);

CREATE INDEX IF NOT EXISTS idx_proposal_exports_tenant
    ON proposal_exports (tenant_id);

-- =============================================================================
-- 11. ALTER tenant_uploads — Add parsing/atomization columns
-- =============================================================================

ALTER TABLE tenant_uploads ADD COLUMN IF NOT EXISTS parsing_status TEXT DEFAULT 'pending';  -- pending, processing, completed, failed
ALTER TABLE tenant_uploads ADD COLUMN IF NOT EXISTS parsed_content JSONB;  -- Docling structured output
ALTER TABLE tenant_uploads ADD COLUMN IF NOT EXISTS atom_count INT DEFAULT 0;
ALTER TABLE tenant_uploads ADD COLUMN IF NOT EXISTS parsing_error TEXT;
ALTER TABLE tenant_uploads ADD COLUMN IF NOT EXISTS parsing_started_at TIMESTAMPTZ;
ALTER TABLE tenant_uploads ADD COLUMN IF NOT EXISTS parsing_completed_at TIMESTAMPTZ;

-- =============================================================================
-- VIEWS
-- =============================================================================

-- Proposal dashboard: unified view for the portal UI
CREATE OR REPLACE VIEW proposal_dashboard AS
SELECT
    p.id AS proposal_id,
    p.tenant_id,
    p.title AS proposal_title,
    p.status AS proposal_status,
    p.page_limit,
    p.current_page_est,
    p.completion_pct,
    p.outcome,
    p.created_at AS proposal_created_at,
    p.updated_at AS proposal_updated_at,
    o.id AS opportunity_id,
    o.title AS opportunity_title,
    o.agency,
    o.solicitation_number,
    o.close_date,
    o.opportunity_type,
    EXTRACT(DAY FROM (o.close_date - NOW()))::INT AS days_to_close,
    rt.template_name,
    rt.source AS template_source,
    (SELECT COUNT(*) FROM proposal_sections ps WHERE ps.proposal_id = p.id) AS total_sections,
    (SELECT COUNT(*) FROM proposal_sections ps WHERE ps.proposal_id = p.id AND ps.status IN ('approved', 'locked')) AS completed_sections,
    (SELECT COUNT(*) FROM proposal_personnel pp WHERE pp.proposal_id = p.id) AS personnel_count,
    (SELECT COUNT(*) FROM proposal_exports pe WHERE pe.proposal_id = p.id) AS export_count,
    u.name AS created_by_name,
    u.email AS created_by_email
FROM proposals p
JOIN opportunities o ON o.id = p.opportunity_id
LEFT JOIN rfp_templates rt ON rt.id = p.rfp_template_id
LEFT JOIN users u ON u.id = p.created_by;

-- Library unit summary: per-tenant content library stats
CREATE OR REPLACE VIEW library_unit_summary AS
SELECT
    lu.tenant_id,
    t.name AS tenant_name,
    COUNT(*) AS total_units,
    COUNT(*) FILTER (WHERE lu.status = 'approved') AS approved_units,
    COUNT(*) FILTER (WHERE lu.status = 'draft') AS draft_units,
    COUNT(*) FILTER (WHERE lu.embedding IS NOT NULL) AS vectorized_units,
    COUNT(DISTINCT lu.category) AS category_count,
    jsonb_object_agg(
        lu.category,
        (SELECT COUNT(*) FROM library_units lu2 WHERE lu2.tenant_id = lu.tenant_id AND lu2.category = lu.category AND lu2.status != 'archived')
    ) FILTER (WHERE lu.status != 'archived') AS units_by_category,
    MAX(lu.created_at) AS last_unit_created,
    SUM(lu.usage_count) AS total_usage
FROM library_units lu
JOIN tenants t ON t.id = lu.tenant_id
WHERE lu.status != 'archived'
GROUP BY lu.tenant_id, t.name;

COMMIT;
