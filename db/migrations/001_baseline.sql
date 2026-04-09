-- ============================================================================
-- RFP Pipeline SaaS — Clean Baseline Migration
-- Creates ALL tables for the complete system
-- ============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- UTILITY FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CORE: AUTH & TENANCY
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    legal_name      TEXT,
    website         TEXT,
    status          TEXT NOT NULL DEFAULT 'trial' CHECK (status IN ('active','suspended','churned','trial')),
    product_tier    TEXT NOT NULL DEFAULT 'finder' CHECK (product_tier IN ('finder','reminder','binder','grinder')),
    billing_email   TEXT,
    trial_ends_at   TIMESTAMPTZ,
    storage_root    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS tenants_updated ON tenants;
CREATE TRIGGER tenants_updated BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    name            TEXT,
    role            TEXT NOT NULL DEFAULT 'tenant_user' CHECK (role IN ('master_admin','rfp_admin','tenant_admin','tenant_user','partner_user')),
    tenant_id       UUID REFERENCES tenants(id),
    password_hash   TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    temp_password   BOOLEAN NOT NULL DEFAULT false,
    last_login_at   TIMESTAMPTZ,
    terms_accepted_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS users_updated ON users;
CREATE TRIGGER users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

-- NextAuth tables
CREATE TABLE IF NOT EXISTS accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            TEXT NOT NULL,
    provider        TEXT NOT NULL,
    provider_account_id TEXT NOT NULL,
    refresh_token   TEXT,
    access_token    TEXT,
    expires_at      BIGINT,
    token_type      TEXT,
    scope           TEXT,
    id_token        TEXT,
    UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_token   TEXT UNIQUE NOT NULL,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires         TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_tokens (
    identifier      TEXT NOT NULL,
    token           TEXT UNIQUE NOT NULL,
    expires         TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS tenant_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID UNIQUE NOT NULL REFERENCES tenants(id),
    naics_codes     TEXT[] DEFAULT '{}',
    keywords        TEXT[] DEFAULT '{}',
    agency_priorities TEXT[] DEFAULT '{}',
    set_aside_types TEXT[] DEFAULT '{}',
    technology_focus TEXT,
    company_summary TEXT,
    research_areas  TEXT[] DEFAULT '{}',
    target_agencies TEXT[] DEFAULT '{}',
    min_surface_score INT DEFAULT 40,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS tenant_profiles_updated ON tenant_profiles;
CREATE TRIGGER tenant_profiles_updated BEFORE UPDATE ON tenant_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- OPPORTUNITIES & PIPELINE
-- ============================================================================

CREATE TABLE IF NOT EXISTS opportunities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          TEXT NOT NULL,
    source_id       TEXT NOT NULL,
    title           TEXT NOT NULL,
    agency          TEXT,
    office          TEXT,
    solicitation_number TEXT,
    naics_codes     TEXT[] DEFAULT '{}',
    classification_code TEXT,
    set_aside_type  TEXT,
    program_type    TEXT,
    close_date      TIMESTAMPTZ,
    posted_date     TIMESTAMPTZ,
    estimated_value_min NUMERIC,
    estimated_value_max NUMERIC,
    description     TEXT,
    content_hash    TEXT,
    full_text_tsv   TSVECTOR,
    award_date      TIMESTAMPTZ,
    award_amount    NUMERIC,
    awardee         TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(source, source_id)
);
DROP TRIGGER IF EXISTS opportunities_updated ON opportunities;
CREATE TRIGGER opportunities_updated BEFORE UPDATE ON opportunities FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_opp_source ON opportunities(source, source_id);
CREATE INDEX IF NOT EXISTS idx_opp_agency ON opportunities(agency);
CREATE INDEX IF NOT EXISTS idx_opp_close ON opportunities(close_date);
CREATE INDEX IF NOT EXISTS idx_opp_active ON opportunities(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_opp_fts ON opportunities USING GIN (full_text_tsv);

CREATE TABLE IF NOT EXISTS tenant_pipeline_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    opportunity_id  UUID NOT NULL REFERENCES opportunities(id),
    total_score     INT NOT NULL DEFAULT 0,
    naics_score     INT DEFAULT 0,
    keyword_score   INT DEFAULT 0,
    agency_score    INT DEFAULT 0,
    set_aside_score INT DEFAULT 0,
    type_score      INT DEFAULT 0,
    timeline_score  INT DEFAULT 0,
    llm_adjustment  INT DEFAULT 0 CHECK (llm_adjustment BETWEEN -15 AND 15),
    llm_rationale   TEXT,
    priority_tier   TEXT GENERATED ALWAYS AS (
        CASE WHEN total_score >= 75 THEN 'high' WHEN total_score >= 50 THEN 'medium' ELSE 'low' END
    ) STORED,
    pursuit_status  TEXT NOT NULL DEFAULT 'unreviewed' CHECK (pursuit_status IN ('unreviewed','pursuing','monitoring','passed')),
    recommendation  TEXT,
    matched_keywords TEXT[] DEFAULT '{}',
    is_pinned       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, opportunity_id)
);
DROP TRIGGER IF EXISTS tpi_updated ON tenant_pipeline_items;
CREATE TRIGGER tpi_updated BEFORE UPDATE ON tenant_pipeline_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_tpi_tenant_score ON tenant_pipeline_items(tenant_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_tpi_tenant_pursuit ON tenant_pipeline_items(tenant_id, pursuit_status);

CREATE TABLE IF NOT EXISTS tenant_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    opportunity_id  UUID NOT NULL REFERENCES opportunities(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    action_type     TEXT NOT NULL CHECK (action_type IN ('thumbs_up','thumbs_down','pin','unpin','comment','status_change')),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- RFP CURATION (Admin workspace)
-- ============================================================================

CREATE TABLE IF NOT EXISTS compliance_variables (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT UNIQUE NOT NULL,
    label           TEXT NOT NULL,
    category        TEXT NOT NULL,
    data_type       TEXT NOT NULL DEFAULT 'text' CHECK (data_type IN ('text','number','boolean','select','multiselect')),
    options         JSONB,
    is_system       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS curated_solicitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id  UUID NOT NULL REFERENCES opportunities(id),
    namespace       TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','claimed','released','ai_analyzed','curation_in_progress','review_requested','approved','pushed_to_pipeline','dismissed')),
    claimed_by      UUID REFERENCES users(id),
    claimed_at      TIMESTAMPTZ,
    curated_by      UUID REFERENCES users(id),
    approved_by     UUID REFERENCES users(id),
    pushed_at       TIMESTAMPTZ,
    dismissed_reason TEXT,
    phase_like      TEXT CHECK (phase_like IN ('phase_1','phase_2')),
    ai_extracted    JSONB,
    ai_confidence   FLOAT,
    ai_similar_to   UUID REFERENCES curated_solicitations(id),
    ai_similarity_score FLOAT,
    full_text       TEXT,
    full_text_tsv   TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', COALESCE(full_text, ''))) STORED,
    annotations     JSONB DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS curated_sol_updated ON curated_solicitations;
CREATE TRIGGER curated_sol_updated BEFORE UPDATE ON curated_solicitations FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_csol_status ON curated_solicitations(status);
CREATE INDEX IF NOT EXISTS idx_csol_namespace ON curated_solicitations(namespace);
CREATE INDEX IF NOT EXISTS idx_csol_opp ON curated_solicitations(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_csol_fts ON curated_solicitations USING GIN (full_text_tsv);

CREATE TABLE IF NOT EXISTS solicitation_compliance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id UUID NOT NULL REFERENCES curated_solicitations(id),
    page_limit_technical INT,
    page_limit_cost INT,
    page_limit_other JSONB,
    font_family     TEXT,
    font_size       TEXT,
    margins         TEXT,
    line_spacing    TEXT,
    header_required BOOLEAN DEFAULT false,
    header_format   TEXT,
    footer_required BOOLEAN DEFAULT false,
    footer_format   TEXT,
    submission_format TEXT,
    images_tables_allowed BOOLEAN DEFAULT true,
    slides_allowed  BOOLEAN DEFAULT false,
    slide_limit     INT,
    slide_order     JSONB,
    required_sections JSONB NOT NULL DEFAULT '[]',
    required_documents JSONB NOT NULL DEFAULT '[]',
    evaluation_criteria JSONB NOT NULL DEFAULT '[]',
    taba_allowed    BOOLEAN,
    indirect_rate_cap NUMERIC,
    partner_max_pct NUMERIC,
    cost_sharing_required BOOLEAN DEFAULT false,
    cost_volume_format TEXT,
    pi_must_be_employee BOOLEAN,
    pi_university_allowed BOOLEAN,
    clearance_required TEXT,
    itar_required   BOOLEAN DEFAULT false,
    far_clauses     TEXT[] DEFAULT '{}',
    custom_variables JSONB DEFAULT '{}',
    verified_by     UUID REFERENCES users(id),
    verified_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solicitation_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id UUID REFERENCES curated_solicitations(id),
    namespace       TEXT,
    document_name   TEXT NOT NULL,
    document_type   TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    file_hash       TEXT,
    uploaded_by     UUID REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solicitation_outlines (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id UUID NOT NULL REFERENCES curated_solicitations(id),
    outline         JSONB NOT NULL,
    notes           TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS solicitation_topics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id UUID NOT NULL REFERENCES curated_solicitations(id),
    topic_number    TEXT,
    title           TEXT NOT NULL,
    description     TEXT,
    itar_required   BOOLEAN DEFAULT false,
    classification  TEXT,
    far_overrides   TEXT[] DEFAULT '{}',
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ============================================================================
-- PROPOSALS & WORKSPACE
-- ============================================================================

CREATE TABLE IF NOT EXISTS proposals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    opportunity_id  UUID NOT NULL REFERENCES opportunities(id),
    solicitation_id UUID REFERENCES curated_solicitations(id),
    title           TEXT NOT NULL,
    stage           TEXT NOT NULL DEFAULT 'outline' CHECK (stage IN ('outline','draft','pink_team','red_team','gold_team','final','submitted','archived')),
    stripe_payment_id TEXT,
    is_locked       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS proposals_updated ON proposals;
CREATE TRIGGER proposals_updated BEFORE UPDATE ON proposals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_proposals_tenant ON proposals(tenant_id);

CREATE TABLE IF NOT EXISTS proposal_sections (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id     UUID NOT NULL REFERENCES proposals(id),
    section_number  TEXT NOT NULL,
    title           TEXT NOT NULL,
    content         TEXT,
    page_allocation INT,
    status          TEXT NOT NULL DEFAULT 'empty' CHECK (status IN ('empty','ai_drafted','in_progress','complete','approved')),
    assigned_to     UUID REFERENCES users(id),
    requirement_ids UUID[] DEFAULT '{}',
    ai_confidence   FLOAT,
    version         INT NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS sections_updated ON proposal_sections;
CREATE TRIGGER sections_updated BEFORE UPDATE ON proposal_sections FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS proposal_collaborators (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id     UUID NOT NULL REFERENCES proposals(id),
    user_id         UUID REFERENCES users(id),
    email           TEXT NOT NULL,
    name            TEXT,
    role            TEXT NOT NULL DEFAULT 'contributor',
    invited_by      UUID REFERENCES users(id),
    invited_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    accepted_at     TIMESTAMPTZ,
    UNIQUE(proposal_id, email)
);

CREATE TABLE IF NOT EXISTS collaborator_stage_access (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collaborator_id UUID NOT NULL REFERENCES proposal_collaborators(id),
    proposal_id     UUID NOT NULL REFERENCES proposals(id),
    stage           TEXT NOT NULL,
    artifact_types  TEXT[] DEFAULT '{}',
    permission      TEXT NOT NULL DEFAULT 'view' CHECK (permission IN ('view','comment','edit')),
    access_granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    access_revoked_at TIMESTAMPTZ,
    granted_by      UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_csa_collab ON collaborator_stage_access(collaborator_id);
CREATE INDEX IF NOT EXISTS idx_csa_proposal_stage ON collaborator_stage_access(proposal_id, stage);

CREATE TABLE IF NOT EXISTS proposal_stage_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id     UUID NOT NULL REFERENCES proposals(id),
    from_stage      TEXT,
    to_stage        TEXT NOT NULL,
    changed_by      UUID REFERENCES users(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposal_comments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id     UUID NOT NULL REFERENCES proposals(id),
    section_id      UUID REFERENCES proposal_sections(id),
    user_id         UUID NOT NULL REFERENCES users(id),
    content         TEXT NOT NULL,
    resolved        BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposal_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id     UUID NOT NULL REFERENCES proposals(id),
    stage           TEXT NOT NULL,
    reviewer_id     UUID REFERENCES users(id),
    is_ai_review    BOOLEAN NOT NULL DEFAULT false,
    overall_score   INT,
    strengths       TEXT,
    weaknesses      TEXT,
    recommendations TEXT,
    section_scores  JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposal_compliance_matrix (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id     UUID NOT NULL REFERENCES proposals(id),
    requirement_text TEXT NOT NULL,
    requirement_source TEXT,
    is_mandatory    BOOLEAN NOT NULL DEFAULT true,
    status          TEXT NOT NULL DEFAULT 'not_addressed' CHECK (status IN ('not_addressed','partial','satisfied','not_applicable')),
    section_id      UUID REFERENCES proposal_sections(id),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- CONTENT LIBRARY
-- ============================================================================

CREATE TABLE IF NOT EXISTS library_units (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    content         TEXT NOT NULL,
    category        TEXT NOT NULL,
    subcategory     TEXT,
    tags            TEXT[] DEFAULT '{}',
    embedding       vector(1536),
    confidence      FLOAT NOT NULL DEFAULT 0.5,
    status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','archived')),
    source_type     TEXT DEFAULT 'manual' CHECK (source_type IN ('manual','upload','harvest','ai')),
    source_id       TEXT,
    usage_count     INT NOT NULL DEFAULT 0,
    parent_unit_id  UUID REFERENCES library_units(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS library_updated ON library_units;
CREATE TRIGGER library_updated BEFORE UPDATE ON library_units FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE INDEX IF NOT EXISTS idx_library_tenant ON library_units(tenant_id);
CREATE INDEX IF NOT EXISTS idx_library_tenant_cat ON library_units(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_library_status ON library_units(status) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_library_embedding ON library_units USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 128);

CREATE TABLE IF NOT EXISTS library_harvest_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    proposal_id     UUID REFERENCES proposals(id),
    unit_id         UUID REFERENCES library_units(id),
    harvested_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS library_atom_outcomes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    unit_id         UUID NOT NULL REFERENCES library_units(id),
    proposal_id     UUID NOT NULL REFERENCES proposals(id),
    outcome         TEXT CHECK (outcome IN ('win','loss','pending')),
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    file_name       TEXT NOT NULL,
    file_path       TEXT NOT NULL,
    file_size       BIGINT,
    mime_type       TEXT,
    uploaded_by     UUID REFERENCES users(id),
    processed       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- AGENT FABRIC
-- ============================================================================

CREATE TABLE IF NOT EXISTS agent_archetypes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name       TEXT UNIQUE NOT NULL,
    display_name    TEXT NOT NULL,
    system_prompt   TEXT NOT NULL,
    tools           TEXT[] NOT NULL DEFAULT '{}',
    max_tokens      INT NOT NULL DEFAULT 4096,
    temperature     FLOAT NOT NULL DEFAULT 0.3,
    human_gate      BOOLEAN NOT NULL DEFAULT true,
    memory_categories TEXT[] DEFAULT '{}',
    guardrails      JSONB DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS episodic_memories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_role      TEXT NOT NULL,
    embedding       vector(1536) NOT NULL,
    content         TEXT NOT NULL,
    memory_type     TEXT NOT NULL DEFAULT 'observation' CHECK (memory_type IN ('observation','interaction','decision','outcome')),
    importance      FLOAT NOT NULL DEFAULT 0.5,
    entities        JSONB DEFAULT '[]',
    metadata        JSONB DEFAULT '{}',
    source          TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed   TIMESTAMPTZ NOT NULL DEFAULT now(),
    access_count    INT NOT NULL DEFAULT 0,
    decay_factor    FLOAT NOT NULL DEFAULT 1.0,
    is_archived     BOOLEAN NOT NULL DEFAULT false,
    superseded_by   UUID REFERENCES episodic_memories(id)
);
CREATE INDEX IF NOT EXISTS idx_em_tenant ON episodic_memories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_em_tenant_role ON episodic_memories(tenant_id, agent_role);
CREATE INDEX IF NOT EXISTS idx_em_archived ON episodic_memories(is_archived) WHERE NOT is_archived;
CREATE INDEX IF NOT EXISTS idx_em_embedding ON episodic_memories USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 128);
CREATE INDEX IF NOT EXISTS idx_em_entities ON episodic_memories USING GIN (entities);

CREATE TABLE IF NOT EXISTS semantic_memories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_role      TEXT NOT NULL,
    embedding       vector(1536) NOT NULL,
    content         TEXT NOT NULL,
    category        TEXT NOT NULL,
    subcategory     TEXT,
    confidence      FLOAT NOT NULL DEFAULT 0.5,
    evidence_count  INT NOT NULL DEFAULT 1,
    relationships   JSONB DEFAULT '[]',
    source_memories UUID[] DEFAULT '{}',
    valid_from      TIMESTAMPTZ DEFAULT now(),
    valid_until     TIMESTAMPTZ,
    version         INT NOT NULL DEFAULT 1,
    previous_version UUID REFERENCES semantic_memories(id),
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_accessed   TIMESTAMPTZ NOT NULL DEFAULT now(),
    access_count    INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sm_tenant ON semantic_memories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sm_tenant_cat ON semantic_memories(tenant_id, category);
CREATE INDEX IF NOT EXISTS idx_sm_active ON semantic_memories(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_sm_embedding ON semantic_memories USING hnsw (embedding vector_cosine_ops) WITH (m = 24, ef_construction = 200);

CREATE TABLE IF NOT EXISTS procedural_memories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_role      TEXT NOT NULL,
    embedding       vector(1536) NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT NOT NULL,
    steps           JSONB NOT NULL DEFAULT '[]',
    trigger_conditions JSONB DEFAULT '{}',
    success_rate    FLOAT DEFAULT 0.5,
    execution_count INT NOT NULL DEFAULT 0,
    last_executed   TIMESTAMPTZ,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pm_tenant ON procedural_memories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pm_active ON procedural_memories(is_active) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_pm_embedding ON procedural_memories USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 128);

CREATE TABLE IF NOT EXISTS agent_task_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_role      TEXT NOT NULL,
    task_type       TEXT NOT NULL,
    trigger_event   TEXT,
    proposal_id     UUID REFERENCES proposals(id),
    section_id      UUID REFERENCES proposal_sections(id),
    input_tokens    INT,
    output_tokens   INT,
    tool_calls_count INT DEFAULT 0,
    duration_ms     INT,
    cost_usd        NUMERIC(10,6),
    human_accepted  BOOLEAN,
    human_edit_pct  FLOAT,
    memories_retrieved INT DEFAULT 0,
    memories_written INT DEFAULT 0,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atl_tenant ON agent_task_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_atl_tenant_role ON agent_task_log(tenant_id, agent_role);

CREATE TABLE IF NOT EXISTS agent_task_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_role      TEXT NOT NULL,
    task_type       TEXT NOT NULL,
    input           JSONB NOT NULL,
    proposal_id     UUID REFERENCES proposals(id),
    section_id      UUID REFERENCES proposal_sections(id),
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
    worker_id       TEXT,
    picked_at       TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_atq_status ON agent_task_queue(status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS agent_task_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id         UUID NOT NULL REFERENCES agent_task_queue(id),
    output          JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_agent_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID UNIQUE NOT NULL REFERENCES tenants(id),
    enabled_agents  TEXT[] DEFAULT '{}',
    monthly_budget  NUMERIC(10,2) DEFAULT 50.00,
    monthly_used    NUMERIC(10,2) DEFAULT 0.00,
    preferences     JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_performance (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    agent_role      TEXT NOT NULL,
    period_start    DATE NOT NULL,
    period_end      DATE NOT NULL,
    tasks_completed INT DEFAULT 0,
    acceptance_rate FLOAT,
    avg_edit_pct    FLOAT,
    avg_cost_usd    NUMERIC(10,6),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, agent_role, period_start)
);

-- ============================================================================
-- EVENT BUS & AUTOMATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS opportunity_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      TEXT NOT NULL,
    opportunity_id  UUID REFERENCES opportunities(id),
    source          TEXT,
    metadata        JSONB DEFAULT '{}',
    processed       BOOLEAN NOT NULL DEFAULT false,
    processed_by    TEXT,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customer_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      TEXT NOT NULL,
    tenant_id       UUID REFERENCES tenants(id),
    user_id         UUID REFERENCES users(id),
    metadata        JSONB DEFAULT '{}',
    processed       BOOLEAN NOT NULL DEFAULT false,
    processed_by    TEXT,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS content_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      TEXT NOT NULL,
    metadata        JSONB DEFAULT '{}',
    processed       BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT UNIQUE NOT NULL,
    trigger_bus     TEXT NOT NULL CHECK (trigger_bus IN ('opportunity_events','customer_events','content_events')),
    trigger_events  TEXT[] NOT NULL,
    conditions      JSONB DEFAULT '{}',
    action_type     TEXT NOT NULL CHECK (action_type IN ('log_only','queue_notification','queue_job','emit_event')),
    action_config   JSONB DEFAULT '{}',
    cooldown_minutes INT DEFAULT 0,
    max_fires_per_hour INT DEFAULT 100,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS automation_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id         UUID REFERENCES automation_rules(id),
    trigger_event_id UUID,
    action_taken    TEXT,
    result          JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- CONTROL PLANE
-- ============================================================================

CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          TEXT NOT NULL,
    run_type        TEXT NOT NULL DEFAULT 'full',
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
    worker_id       TEXT,
    result          JSONB,
    error           TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pj_status ON pipeline_jobs(status) WHERE status IN ('pending','running');

CREATE TABLE IF NOT EXISTS pipeline_schedules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          TEXT NOT NULL UNIQUE,
    run_type        TEXT NOT NULL DEFAULT 'full',
    cron_expression TEXT NOT NULL,
    enabled         BOOLEAN NOT NULL DEFAULT true,
    next_run_at     TIMESTAMPTZ,
    last_run_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          UUID REFERENCES pipeline_jobs(id),
    source          TEXT NOT NULL,
    run_type        TEXT NOT NULL,
    metrics         JSONB DEFAULT '{}',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS api_key_registry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          TEXT UNIQUE NOT NULL,
    encrypted_key   TEXT,
    key_hint        TEXT,
    expires_at      TIMESTAMPTZ,
    last_validated   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rate_limit_state (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          TEXT UNIQUE NOT NULL,
    daily_limit     INT NOT NULL DEFAULT 1000,
    daily_used      INT NOT NULL DEFAULT 0,
    hourly_limit    INT NOT NULL DEFAULT 100,
    hourly_used     INT NOT NULL DEFAULT 0,
    last_reset_daily TIMESTAMPTZ DEFAULT now(),
    last_reset_hourly TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_health (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          TEXT UNIQUE NOT NULL,
    status          TEXT NOT NULL DEFAULT 'unknown' CHECK (status IN ('healthy','degraded','error','unknown')),
    consecutive_failures INT NOT NULL DEFAULT 0,
    last_success_at TIMESTAMPTZ,
    last_failure_at TIMESTAMPTZ,
    avg_duration_ms INT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS system_config (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    description     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- IDENTITY & BILLING
-- ============================================================================

CREATE TABLE IF NOT EXISTS invitations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    email           TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'tenant_user',
    token           TEXT UNIQUE NOT NULL,
    invited_by      UUID REFERENCES users(id),
    accepted_at     TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS consent_records (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id),
    document_type   TEXT NOT NULL,
    document_version TEXT NOT NULL,
    accepted_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    ip_address      TEXT
);

CREATE TABLE IF NOT EXISTS legal_document_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_type   TEXT NOT NULL,
    version         TEXT NOT NULL,
    content_hash    TEXT,
    effective_date  DATE NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(document_type, version)
);

CREATE TABLE IF NOT EXISTS purchases (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    opportunity_id  UUID REFERENCES opportunities(id),
    proposal_id     UUID REFERENCES proposals(id),
    stripe_session_id TEXT,
    stripe_payment_intent TEXT,
    product_type    TEXT NOT NULL CHECK (product_type IN ('finder_subscription','proposal_phase1','proposal_phase2')),
    amount_cents    INT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','refunded')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID REFERENCES tenants(id),
    user_id         UUID REFERENCES users(id),
    action          TEXT NOT NULL,
    entity_type     TEXT,
    entity_id       TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ANALYTICS
-- ============================================================================

CREATE TABLE IF NOT EXISTS visitor_sessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      TEXT UNIQUE NOT NULL,
    first_page      TEXT,
    referrer        TEXT,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS page_views (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      TEXT NOT NULL,
    page_path       TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waitlist (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE NOT NULL,
    company_name    TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- SPOTLIGHTS
-- ============================================================================

CREATE TABLE IF NOT EXISTS spotlights (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            TEXT NOT NULL,
    description     TEXT,
    naics_codes     TEXT[] DEFAULT '{}',
    keywords        TEXT[] DEFAULT '{}',
    agencies        TEXT[] DEFAULT '{}',
    program_types   TEXT[] DEFAULT '{}',
    min_score       INT DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- ROW-LEVEL SECURITY
-- ============================================================================

ALTER TABLE episodic_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedural_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_task_log ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- NOTIFY TRIGGERS (for pipeline LISTEN/NOTIFY)
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_pipeline_worker() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('pipeline_worker', json_build_object('id', NEW.id, 'source', NEW.source)::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER pipeline_jobs_notify AFTER INSERT ON pipeline_jobs FOR EACH ROW EXECUTE FUNCTION notify_pipeline_worker();

CREATE OR REPLACE FUNCTION notify_event_bus() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(TG_TABLE_NAME, json_build_object('id', NEW.id, 'event_type', NEW.event_type)::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER opp_events_notify AFTER INSERT ON opportunity_events FOR EACH ROW EXECUTE FUNCTION notify_event_bus();
CREATE TRIGGER cust_events_notify AFTER INSERT ON customer_events FOR EACH ROW EXECUTE FUNCTION notify_event_bus();
CREATE TRIGGER content_events_notify AFTER INSERT ON content_events FOR EACH ROW EXECUTE FUNCTION notify_event_bus();

-- ============================================================================
-- Initial master_admin bootstrap
-- ----------------------------------------------------------------------------
-- The very first row in the users table: the system's root administrator.
-- Baked into the baseline migration so every fresh deploy (local, Railway,
-- CI) has a working login the moment the schema is created, without needing
-- a separate seed step or env var coordination.
--
-- email:    eric@rfppipeline.com
-- password: !Wags$$   (the bcrypt hash below corresponds to this plaintext —
--                     verified locally with bcryptjs.compareSync at cost 12)
-- role:     master_admin
-- temp_password = true → middleware force-redirects to /change-password on
-- first sign-in, so the bootstrap credential MUST be rotated before the
-- user can access any other route.
--
-- ON CONFLICT (email) DO NOTHING keeps this idempotent on every run. On
-- the existing Railway DB where the same hash was already inserted via
-- the old 005_bootstrap_master_admin.sql migration, this is a no-op. On a
-- fresh database it creates the row.
-- ============================================================================
INSERT INTO users (email, name, role, password_hash, is_active, temp_password)
VALUES (
  'eric@rfppipeline.com',
  'Eric (Master Admin)',
  'master_admin',
  '$2a$12$tM8UzLbaFSjxViTNhC13V.fuj.G56EDgIQZh4oRbthERf9PFs2T7S',
  true,
  true
)
ON CONFLICT (email) DO NOTHING;

