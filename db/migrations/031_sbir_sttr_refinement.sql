-- =============================================================================
-- Migration 031 — SBIR/STTR Refinement
-- Narrows the platform from general federal contracting to focused
-- SBIR/STTR opportunity finder + proposal build service.
--
-- Creates: proposal_purchases, master_templates, partner_access_grants
-- Alters:  users, opportunities, tenant_profiles, focus_areas,
--          proposal_collaborators, customer_events, opportunity_events, proposals
-- Seeds:   master_templates (6 agency templates), legal_document_versions,
--          pipeline_schedules update
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. proposal_purchases — Track per-proposal purchases ($499 / $999)
-- =============================================================================

CREATE TABLE IF NOT EXISTS proposal_purchases (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id),
    proposal_id             UUID REFERENCES proposals(id),
    opportunity_id          UUID REFERENCES opportunities(id),
    purchase_type           TEXT NOT NULL CHECK (purchase_type IN ('phase_1', 'phase_2')),
    price_cents             INTEGER NOT NULL,  -- 49900 or 99900
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                                'pending',
                                'active',
                                'template_delivered',
                                'completed',
                                'cancelled',
                                'refunded'
                            )),
    purchased_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    cancellation_deadline   TIMESTAMPTZ NOT NULL,  -- purchased_at + 72 hours
    template_delivered_at   TIMESTAMPTZ,
    template_id             UUID,  -- references master_templates (FK added after table exists)
    cancelled_at            TIMESTAMPTZ,
    refund_reason           TEXT,
    delivered_by            TEXT REFERENCES users(id),
    notes                   TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchases_tenant
    ON proposal_purchases(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_purchases_status
    ON proposal_purchases(status) WHERE status IN ('pending', 'active');

-- =============================================================================
-- 2. master_templates — Admin-managed SBIR/STTR template library
-- =============================================================================

CREATE TABLE IF NOT EXISTS master_templates (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency                  TEXT NOT NULL,
    component               TEXT,
    program_type            TEXT NOT NULL CHECK (program_type IN (
                                'sbir_phase_1', 'sbir_phase_2',
                                'sttr_phase_1', 'sttr_phase_2',
                                'ota', 'baa', 'challenge', 'other'
                            )),
    template_name           TEXT NOT NULL,
    description             TEXT,
    sections                JSONB NOT NULL DEFAULT '[]',
    page_limits             JSONB,
    eval_criteria           JSONB,
    submission_format       JSONB,
    version                 INTEGER NOT NULL DEFAULT 1,
    is_current              BOOLEAN DEFAULT TRUE,
    solicitation_pattern    TEXT,
    notes                   TEXT,
    created_by              TEXT REFERENCES users(id),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_templates_agency
    ON master_templates(agency, program_type, is_current);

-- Use DO block for unique index since IF NOT EXISTS is not supported on
-- CREATE UNIQUE INDEX in all PG versions
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_templates_name_version'
    ) THEN
        CREATE UNIQUE INDEX idx_templates_name_version
            ON master_templates(template_name, version);
    END IF;
END $$;

-- Now add FK from proposal_purchases.template_id -> master_templates
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'fk_purchases_template'
          AND table_name = 'proposal_purchases'
    ) THEN
        ALTER TABLE proposal_purchases
            ADD CONSTRAINT fk_purchases_template
            FOREIGN KEY (template_id) REFERENCES master_templates(id);
    END IF;
END $$;

-- =============================================================================
-- 3. partner_access_grants — Full lifecycle partner access tracking
-- =============================================================================

CREATE TABLE IF NOT EXISTS partner_access_grants (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id               UUID NOT NULL REFERENCES tenants(id),
    proposal_id             UUID NOT NULL REFERENCES proposals(id),
    invited_by              TEXT NOT NULL REFERENCES users(id),
    granted_by              TEXT REFERENCES users(id),
    status                  TEXT NOT NULL DEFAULT 'pending_acceptance' CHECK (status IN (
                                'pending_acceptance',
                                'pending_approval',
                                'active',
                                'revoked',
                                'expired',
                                'rejected'
                            )),
    permissions             JSONB NOT NULL DEFAULT '{
        "default": "view",
        "sections": {},
        "uploads": {"can_upload": true, "can_delete_own": true, "can_view_all": false, "can_view_shared": true},
        "library": {"can_access": false},
        "proposal": {"can_view_metadata": true, "can_advance_stage": false, "can_export": false}
    }'::jsonb,
    access_scope            TEXT NOT NULL DEFAULT 'proposal_only' CHECK (access_scope IN (
                                'proposal_only', 'proposal_and_files'
                            )),
    expires_at              TIMESTAMPTZ,
    accepted_at             TIMESTAMPTZ,
    approved_at             TIMESTAMPTZ,
    revoked_at              TIMESTAMPTZ,
    revoked_by              TEXT REFERENCES users(id),
    rejection_reason        TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partner_grants_user
    ON partner_access_grants(user_id, status);

CREATE INDEX IF NOT EXISTS idx_partner_grants_proposal
    ON partner_access_grants(proposal_id, status);

CREATE INDEX IF NOT EXISTS idx_partner_grants_tenant
    ON partner_access_grants(tenant_id, status);

-- Only one active/pending grant per user per proposal
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE indexname = 'idx_partner_grants_unique_active'
    ) THEN
        CREATE UNIQUE INDEX idx_partner_grants_unique_active
            ON partner_access_grants(user_id, proposal_id)
            WHERE status IN ('pending_acceptance', 'pending_approval', 'active');
    END IF;
END $$;

-- =============================================================================
-- 4. Users table — add partner_user role
-- =============================================================================

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('master_admin', 'tenant_admin', 'tenant_user', 'partner_user'));

-- =============================================================================
-- 5. Opportunities table — add SBIR/STTR fields
-- =============================================================================

ALTER TABLE opportunities
    ADD COLUMN IF NOT EXISTS program_type TEXT CHECK (program_type IN (
        'sbir_phase_1', 'sbir_phase_2', 'sttr_phase_1', 'sttr_phase_2',
        'ota', 'baa', 'challenge', 'rfi', 'sources_sought', 'other'
    )),
    ADD COLUMN IF NOT EXISTS topic_number TEXT,
    ADD COLUMN IF NOT EXISTS solicitation_agency TEXT,
    ADD COLUMN IF NOT EXISTS phase TEXT,
    ADD COLUMN IF NOT EXISTS program_url TEXT;

CREATE INDEX IF NOT EXISTS idx_opps_program_type ON opportunities(program_type);

-- =============================================================================
-- 6. Tenant profiles — add SBIR-specific fields
-- =============================================================================

ALTER TABLE tenant_profiles
    ADD COLUMN IF NOT EXISTS technology_readiness_level INTEGER
        CHECK (technology_readiness_level BETWEEN 1 AND 9),
    ADD COLUMN IF NOT EXISTS research_areas TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS past_sbir_awards JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS target_agencies TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS company_summary TEXT,
    ADD COLUMN IF NOT EXISTS technology_focus TEXT;

-- =============================================================================
-- 7. Focus areas (spotlights) — add program type filter
-- =============================================================================

ALTER TABLE focus_areas
    ADD COLUMN IF NOT EXISTS program_type_filter TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS agency_filter TEXT[] DEFAULT '{}';

-- =============================================================================
-- 8. Proposal collaborators — enhance for partner access
-- =============================================================================

ALTER TABLE proposal_collaborators
    ADD COLUMN IF NOT EXISTS is_partner BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS partner_scoped_only BOOLEAN DEFAULT FALSE;

-- =============================================================================
-- 9. Customer events — add actor_type for unified audit
-- =============================================================================

ALTER TABLE customer_events
    ADD COLUMN IF NOT EXISTS actor_type TEXT DEFAULT 'user'
        CHECK (actor_type IN ('user', 'partner', 'admin', 'ai_agent', 'system')),
    ADD COLUMN IF NOT EXISTS actor_label TEXT;

ALTER TABLE opportunity_events
    ADD COLUMN IF NOT EXISTS actor_type TEXT DEFAULT 'system'
        CHECK (actor_type IN ('user', 'partner', 'admin', 'ai_agent', 'system')),
    ADD COLUMN IF NOT EXISTS actor_label TEXT;

-- =============================================================================
-- 10. Proposals — add purchase and template references
-- =============================================================================

ALTER TABLE proposals
    ADD COLUMN IF NOT EXISTS purchase_id UUID REFERENCES proposal_purchases(id),
    ADD COLUMN IF NOT EXISTS template_source_id UUID REFERENCES master_templates(id);

-- =============================================================================
-- 11. Seed master templates for major SBIR/STTR agencies
-- =============================================================================

-- DoD SBIR Phase I (Air Force / Army / Navy pattern)
INSERT INTO master_templates (
    agency, component, program_type, template_name, description,
    sections, page_limits, eval_criteria, submission_format,
    version, is_current, solicitation_pattern, created_by
) VALUES (
    'DoD', NULL, 'sbir_phase_1',
    'DoD SBIR Phase I',
    'Standard DoD SBIR Phase I proposal template covering Air Force, Army, Navy, and DARPA topics.',
    '[
        {"key": "cover_page", "title": "Cover Page", "instructions": "Standard SF-424 cover page with all required fields completed.", "page_limit": 1, "required": true, "sort_order": 1},
        {"key": "table_of_contents", "title": "Table of Contents", "instructions": "List all sections with page numbers.", "page_limit": 1, "required": true, "sort_order": 2},
        {"key": "abstract", "title": "Technical Abstract", "instructions": "Unclassified abstract of the proposed effort. Include objectives, description, and anticipated benefits/results.", "page_limit": 1, "required": true, "sort_order": 3},
        {"key": "phase_1_proposal", "title": "Phase I Technical Proposal", "instructions": "Technical approach, feasibility, innovation, and Phase I objectives.", "page_limit": 20, "required": true, "sort_order": 4, "eval_weight": 50},
        {"key": "key_personnel", "title": "Key Personnel", "instructions": "Principal investigator and key staff qualifications, resumes.", "page_limit": 3, "required": true, "sort_order": 5},
        {"key": "related_work", "title": "Related Work & Prior SBIR/STTR", "instructions": "Summary of related R&D, prior SBIR/STTR awards, current funding.", "page_limit": 2, "required": true, "sort_order": 6},
        {"key": "relationship", "title": "Relationship with Phase II or Future R&D", "instructions": "Phase II potential, transition plan, commercialization strategy.", "page_limit": 2, "required": true, "sort_order": 7},
        {"key": "cost_proposal", "title": "Cost Proposal", "instructions": "Detailed cost breakdown: labor, materials, travel, other direct costs, overhead, G&A, profit.", "page_limit": null, "required": true, "sort_order": 8},
        {"key": "facilities", "title": "Facilities/Equipment", "instructions": "Description of facilities and equipment to be used.", "page_limit": 1, "required": false, "sort_order": 9},
        {"key": "subcontracting", "title": "Subcontracting Plan", "instructions": "If applicable, subcontractor details, cost sharing, STTR research institution.", "page_limit": 2, "required": false, "sort_order": 10}
    ]'::jsonb,
    '{"total": 33, "per_section": {"phase_1_proposal": 20, "key_personnel": 3, "related_work": 2, "relationship": 2}}'::jsonb,
    '{"technical": 50, "cost": 25, "schedule": 15, "management": 10}'::jsonb,
    '{"format": "pdf", "max_size_mb": 50, "naming_convention": "CompanyName_TopicNumber_Proposal"}'::jsonb,
    1, TRUE, 'SBIR.*Phase I|DoD SBIR', NULL
)
ON CONFLICT (template_name, version) DO NOTHING;

-- NSF SBIR Phase I
INSERT INTO master_templates (
    agency, component, program_type, template_name, description,
    sections, page_limits, eval_criteria, submission_format,
    version, is_current, solicitation_pattern, created_by
) VALUES (
    'NSF', NULL, 'sbir_phase_1',
    'NSF SBIR Phase I',
    'National Science Foundation SBIR Phase I proposal template with emphasis on broader impacts and commercialization.',
    '[
        {"key": "project_summary", "title": "Project Summary", "instructions": "Overview, intellectual merit, broader impacts. Each in separate paragraph.", "page_limit": 1, "required": true, "sort_order": 1},
        {"key": "project_description", "title": "Project Description", "instructions": "Technical objectives, research plan, innovation, Phase I work plan.", "page_limit": 15, "required": true, "sort_order": 2, "eval_weight": 50},
        {"key": "broader_impacts", "title": "Broader Impacts", "instructions": "Societal benefits, commercialization potential, economic impact.", "page_limit": 3, "required": true, "sort_order": 3, "eval_weight": 20},
        {"key": "commercialization", "title": "Commercialization Plan", "instructions": "Market analysis, competitive landscape, revenue model, go-to-market.", "page_limit": 5, "required": true, "sort_order": 4, "eval_weight": 20},
        {"key": "key_personnel", "title": "Biographical Sketches", "instructions": "NSF-format bio sketches for PI and senior personnel.", "page_limit": 3, "required": true, "sort_order": 5},
        {"key": "budget_justification", "title": "Budget Justification", "instructions": "Detailed justification for all budget line items.", "page_limit": 3, "required": true, "sort_order": 6},
        {"key": "references", "title": "References Cited", "instructions": "Full bibliographic citations for all references.", "page_limit": null, "required": false, "sort_order": 7},
        {"key": "data_management", "title": "Data Management Plan", "instructions": "Plan for data generated during research.", "page_limit": 2, "required": true, "sort_order": 8},
        {"key": "letters_of_support", "title": "Letters of Support", "instructions": "Letters from potential customers, partners, end users.", "page_limit": null, "required": false, "sort_order": 9}
    ]'::jsonb,
    '{"total": 32, "per_section": {"project_description": 15, "broader_impacts": 3, "commercialization": 5}}'::jsonb,
    '{"technical": 50, "broader_impacts": 20, "commercialization": 20, "team": 10}'::jsonb,
    '{"format": "pdf", "max_size_mb": 25, "naming_convention": "NSF_SBIR_CompanyName"}'::jsonb,
    1, TRUE, 'NSF.*SBIR|America.*Seed Fund', NULL
)
ON CONFLICT (template_name, version) DO NOTHING;

-- NIH SEED (SBIR) Phase I
INSERT INTO master_templates (
    agency, component, program_type, template_name, description,
    sections, page_limits, eval_criteria, submission_format,
    version, is_current, solicitation_pattern, created_by
) VALUES (
    'NIH', NULL, 'sbir_phase_1',
    'NIH SEED Phase I',
    'NIH Small Business Education and Entrepreneurial Development (SEED) Phase I proposal template.',
    '[
        {"key": "specific_aims", "title": "Specific Aims", "instructions": "Goals, objectives, expected outcomes. Significance and innovation.", "page_limit": 1, "required": true, "sort_order": 1},
        {"key": "research_strategy", "title": "Research Strategy", "instructions": "Significance, Innovation, Approach. Include preliminary data if available.", "page_limit": 12, "required": true, "sort_order": 2, "eval_weight": 60},
        {"key": "commercialization", "title": "Commercialization Plan", "instructions": "Market analysis, IP strategy, competitive landscape, revenue model.", "page_limit": 6, "required": true, "sort_order": 3, "eval_weight": 20},
        {"key": "key_personnel", "title": "Key Personnel & Biosketches", "instructions": "NIH biosketch format for PI and senior personnel.", "page_limit": 5, "required": true, "sort_order": 4},
        {"key": "facilities", "title": "Facilities & Other Resources", "instructions": "Available equipment, facilities, resources.", "page_limit": 2, "required": true, "sort_order": 5},
        {"key": "budget", "title": "Budget & Justification", "instructions": "PHS 398 modular or detailed budget.", "page_limit": 3, "required": true, "sort_order": 6},
        {"key": "protection_of_subjects", "title": "Protection of Human Subjects", "instructions": "If applicable, IRB approval plan.", "page_limit": 3, "required": false, "sort_order": 7},
        {"key": "consortium", "title": "Consortium/Contractual Arrangements", "instructions": "If applicable, subcontract details.", "page_limit": 1, "required": false, "sort_order": 8}
    ]'::jsonb,
    '{"total": 33, "per_section": {"research_strategy": 12, "commercialization": 6, "key_personnel": 5}}'::jsonb,
    '{"scientific_merit": 60, "commercialization": 20, "team": 10, "budget": 10}'::jsonb,
    '{"format": "pdf", "max_size_mb": 50, "naming_convention": "NIH_SBIR_PI-LastName"}'::jsonb,
    1, TRUE, 'NIH.*SBIR|NIH.*SEED|NIGMS|NHLBI|NCI', NULL
)
ON CONFLICT (template_name, version) DO NOTHING;

-- DoD SBIR Phase II
INSERT INTO master_templates (
    agency, component, program_type, template_name, description,
    sections, page_limits, eval_criteria, submission_format,
    version, is_current, solicitation_pattern, created_by
) VALUES (
    'DoD', NULL, 'sbir_phase_2',
    'DoD SBIR Phase II',
    'Standard DoD SBIR Phase II proposal template. Requires completed Phase I results and detailed transition plan.',
    '[
        {"key": "cover_page", "title": "Cover Page", "instructions": "Standard SF-424 cover page with Phase I contract reference.", "page_limit": 1, "required": true, "sort_order": 1},
        {"key": "abstract", "title": "Technical Abstract", "instructions": "Unclassified abstract summarizing Phase I results and Phase II objectives.", "page_limit": 1, "required": true, "sort_order": 2},
        {"key": "phase_2_proposal", "title": "Phase II Technical Proposal", "instructions": "Detailed technical approach, Phase I results, Phase II objectives and methodology.", "page_limit": 40, "required": true, "sort_order": 3, "eval_weight": 50},
        {"key": "phase_1_results", "title": "Phase I Results", "instructions": "Summary of Phase I accomplishments, data, and findings.", "page_limit": 10, "required": true, "sort_order": 4},
        {"key": "key_personnel", "title": "Key Personnel", "instructions": "Principal investigator and key staff qualifications, resumes.", "page_limit": 5, "required": true, "sort_order": 5},
        {"key": "transition_plan", "title": "Transition/Commercialization Plan", "instructions": "Detailed commercialization strategy, market analysis, customer engagement.", "page_limit": 10, "required": true, "sort_order": 6, "eval_weight": 25},
        {"key": "cost_proposal", "title": "Cost Proposal", "instructions": "Detailed cost breakdown for the full Phase II period of performance.", "page_limit": null, "required": true, "sort_order": 7},
        {"key": "facilities", "title": "Facilities/Equipment", "instructions": "Description of facilities and equipment to be used.", "page_limit": 2, "required": false, "sort_order": 8},
        {"key": "subcontracting", "title": "Subcontracting Plan", "instructions": "If applicable, subcontractor details and cost sharing.", "page_limit": 3, "required": false, "sort_order": 9},
        {"key": "data_rights", "title": "Technical Data Rights Assertion", "instructions": "DFARS 252.227-7013/7014 data rights assertions.", "page_limit": 2, "required": true, "sort_order": 10}
    ]'::jsonb,
    '{"total": 74, "per_section": {"phase_2_proposal": 40, "phase_1_results": 10, "transition_plan": 10, "key_personnel": 5}}'::jsonb,
    '{"technical": 50, "transition": 25, "cost": 15, "management": 10}'::jsonb,
    '{"format": "pdf", "max_size_mb": 100, "naming_convention": "CompanyName_TopicNumber_PhaseII"}'::jsonb,
    1, TRUE, 'SBIR.*Phase II|DoD SBIR.*Phase 2', NULL
)
ON CONFLICT (template_name, version) DO NOTHING;

-- DOE SBIR Phase I
INSERT INTO master_templates (
    agency, component, program_type, template_name, description,
    sections, page_limits, eval_criteria, submission_format,
    version, is_current, solicitation_pattern, created_by
) VALUES (
    'DOE', NULL, 'sbir_phase_1',
    'DOE SBIR Phase I',
    'Department of Energy SBIR Phase I proposal template for clean energy, nuclear, and advanced science topics.',
    '[
        {"key": "abstract", "title": "Project Abstract", "instructions": "Concise summary of the proposed project, objectives, and anticipated impact.", "page_limit": 1, "required": true, "sort_order": 1},
        {"key": "technical_proposal", "title": "Technical Proposal", "instructions": "Innovation, technical approach, R&D objectives, work plan.", "page_limit": 25, "required": true, "sort_order": 2, "eval_weight": 50},
        {"key": "commercialization", "title": "Commercialization Plan", "instructions": "Market analysis, competitive landscape, revenue model, path to market.", "page_limit": 8, "required": true, "sort_order": 3, "eval_weight": 25},
        {"key": "key_personnel", "title": "Key Personnel & Biosketches", "instructions": "PI and senior personnel qualifications and biosketches.", "page_limit": 5, "required": true, "sort_order": 4},
        {"key": "facilities", "title": "Facilities & Equipment", "instructions": "Description of available facilities, equipment, and resources.", "page_limit": 2, "required": true, "sort_order": 5},
        {"key": "budget", "title": "Budget & Justification", "instructions": "Detailed budget with justification for all line items.", "page_limit": null, "required": true, "sort_order": 6},
        {"key": "current_prior_support", "title": "Current & Prior Support", "instructions": "List of current and prior federal R&D support including SBIR/STTR awards.", "page_limit": 2, "required": true, "sort_order": 7}
    ]'::jsonb,
    '{"total": 43, "per_section": {"technical_proposal": 25, "commercialization": 8, "key_personnel": 5}}'::jsonb,
    '{"technical": 50, "commercialization": 25, "team": 15, "budget": 10}'::jsonb,
    '{"format": "pdf", "max_size_mb": 50, "naming_convention": "DOE_SBIR_CompanyName_Topic"}'::jsonb,
    1, TRUE, 'DOE.*SBIR|Department of Energy.*SBIR', NULL
)
ON CONFLICT (template_name, version) DO NOTHING;

-- NASA SBIR Phase I
INSERT INTO master_templates (
    agency, component, program_type, template_name, description,
    sections, page_limits, eval_criteria, submission_format,
    version, is_current, solicitation_pattern, created_by
) VALUES (
    'NASA', NULL, 'sbir_phase_1',
    'NASA SBIR Phase I',
    'NASA SBIR Phase I proposal template for aerospace, space technology, and earth science topics.',
    '[
        {"key": "cover_page", "title": "Cover Page", "instructions": "Standard NASA proposal cover page with subtopic reference.", "page_limit": 1, "required": true, "sort_order": 1},
        {"key": "abstract", "title": "Technical Abstract", "instructions": "Unclassified abstract of the proposed innovation and its relevance to NASA mission.", "page_limit": 1, "required": true, "sort_order": 2},
        {"key": "technical_proposal", "title": "Technical Proposal", "instructions": "Innovation, technical objectives, approach, work plan, and relevance to NASA.", "page_limit": 20, "required": true, "sort_order": 3, "eval_weight": 55},
        {"key": "key_personnel", "title": "Key Personnel", "instructions": "PI and key staff qualifications, relevant experience, and resumes.", "page_limit": 3, "required": true, "sort_order": 4},
        {"key": "related_work", "title": "Related Work & Bibliography", "instructions": "Prior related R&D, SBIR/STTR awards, and relevant publications.", "page_limit": 2, "required": true, "sort_order": 5},
        {"key": "commercialization", "title": "Commercialization Plan", "instructions": "NASA and non-NASA applications, market potential, transition strategy.", "page_limit": 5, "required": true, "sort_order": 6, "eval_weight": 20},
        {"key": "budget", "title": "Budget & Justification", "instructions": "Detailed budget breakdown with justification for all items.", "page_limit": null, "required": true, "sort_order": 7},
        {"key": "facilities", "title": "Facilities/Equipment", "instructions": "Available labs, equipment, and computing resources.", "page_limit": 1, "required": false, "sort_order": 8}
    ]'::jsonb,
    '{"total": 33, "per_section": {"technical_proposal": 20, "commercialization": 5, "key_personnel": 3}}'::jsonb,
    '{"technical": 55, "commercialization": 20, "team": 15, "relevance": 10}'::jsonb,
    '{"format": "pdf", "max_size_mb": 50, "naming_convention": "NASA_SBIR_Subtopic_CompanyName"}'::jsonb,
    1, TRUE, 'NASA.*SBIR|SBIR.*NASA', NULL
)
ON CONFLICT (template_name, version) DO NOTHING;

-- =============================================================================
-- 12. Seed partner consent document types
-- =============================================================================

-- Deactivate any existing versions of these document types first
UPDATE legal_document_versions
SET is_current = FALSE
WHERE document_type IN ('partner_terms_of_service', 'partner_data_responsibility')
  AND is_current = TRUE;

INSERT INTO legal_document_versions (document_type, version, effective_date, summary_of_changes, is_current)
VALUES
    ('partner_terms_of_service', '1.0.0', NOW(), 'Initial partner terms of service for external collaborators', TRUE),
    ('partner_data_responsibility', '1.0.0', NOW(), 'Admin acknowledgment of responsibility for partner data handling', TRUE)
ON CONFLICT (document_type, version) DO NOTHING;

-- =============================================================================
-- 13. Update pipeline_schedules for SBIR focus
-- =============================================================================

UPDATE pipeline_schedules
SET display_name = 'SBIR/STTR Opportunity Scan',
    description  = 'Scan SAM.gov for SBIR, STTR, OTA, BAA, and Challenge opportunities'
WHERE source = 'sam_gov' AND run_type = 'full';

COMMIT;
