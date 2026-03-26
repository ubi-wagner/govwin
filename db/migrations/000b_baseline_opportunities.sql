-- =============================================================================
-- 000b — Opportunities, Scoring, Knowledge Base, Files/Storage
-- Part 2 of 4 baseline migrations (consolidated from 001-022)
-- =============================================================================

-- =============================================================================
-- OPPORTUNITIES
-- =============================================================================

CREATE TABLE IF NOT EXISTS opportunities (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source                  TEXT NOT NULL,
    source_id               TEXT NOT NULL,
    title                   TEXT NOT NULL,
    description             TEXT,
    agency                  TEXT,
    agency_code             TEXT,
    naics_codes             TEXT[],
    set_aside_type          TEXT,
    set_aside_code          TEXT,
    opportunity_type        TEXT,
    posted_date             TIMESTAMPTZ,
    close_date              TIMESTAMPTZ,
    estimated_value_min     NUMERIC(15,2),
    estimated_value_max     NUMERIC(15,2),
    solicitation_number     TEXT,
    contract_number         TEXT,
    source_url              TEXT,
    document_urls           JSONB DEFAULT '[]',
    content_hash            TEXT NOT NULL,
    status                  TEXT DEFAULT 'active',
    raw_data                JSONB,
    classification_code     TEXT,
    department              TEXT,
    sub_tier                TEXT,
    office                  TEXT,
    organization_type       TEXT,
    full_parent_path_code   TEXT,
    pop_city                TEXT,
    pop_state               TEXT,
    pop_country             TEXT DEFAULT 'USA',
    pop_zip                 TEXT,
    office_city             TEXT,
    office_state            TEXT,
    office_zip              TEXT,
    office_country          TEXT,
    contact_name            TEXT,
    contact_email           TEXT,
    contact_phone           TEXT,
    contact_title           TEXT,
    award_date              TIMESTAMPTZ,
    award_number            TEXT,
    award_amount            NUMERIC(15,2),
    awardee_name            TEXT,
    awardee_uei             TEXT,
    awardee_city            TEXT,
    awardee_state           TEXT,
    base_type               TEXT,
    archive_type            TEXT,
    archive_date            TIMESTAMPTZ,
    is_active               BOOLEAN DEFAULT TRUE,
    sam_ui_link             TEXT,
    additional_info_link    TEXT,
    resource_links          JSONB DEFAULT '[]',
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, source_id)
);

CREATE TABLE IF NOT EXISTS tenant_opportunities (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    opportunity_id          UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    total_score             NUMERIC(5,1),
    naics_score             NUMERIC(5,1),
    keyword_score           NUMERIC(5,1),
    set_aside_score         NUMERIC(5,1),
    agency_score            NUMERIC(5,1),
    type_score              NUMERIC(5,1),
    timeline_score          NUMERIC(5,1),
    llm_adjustment          NUMERIC(5,1) DEFAULT 0,
    llm_rationale           TEXT,
    matched_keywords        TEXT[],
    matched_domains         TEXT[],
    pursuit_status          TEXT DEFAULT 'unreviewed',
    pursuit_recommendation  TEXT,
    key_requirements        TEXT[],
    competitive_risks       TEXT[],
    questions_for_rfi       TEXT[],
    priority_tier           TEXT GENERATED ALWAYS AS (
        CASE WHEN total_score >= 75 THEN 'high'
             WHEN total_score >= 50 THEN 'medium'
             ELSE 'low' END
    ) STORED,
    scored_at               TIMESTAMPTZ DEFAULT NOW(),
    rescored_at             TIMESTAMPTZ,
    UNIQUE(tenant_id, opportunity_id)
);

CREATE TABLE IF NOT EXISTS tenant_actions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    opportunity_id      UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    user_id             TEXT NOT NULL REFERENCES users(id),
    action_type         TEXT NOT NULL,
    value               TEXT,
    metadata            JSONB,
    score_at_action     NUMERIC(5,1),
    agency_at_action    TEXT,
    type_at_action      TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS documents (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id      UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    filename            TEXT NOT NULL,
    original_url        TEXT NOT NULL,
    local_path          TEXT,
    extracted_text_path TEXT,
    file_hash           TEXT,
    file_size_bytes     BIGINT,
    mime_type           TEXT,
    document_type       TEXT,
    is_primary          BOOLEAN DEFAULT FALSE,
    download_status     TEXT DEFAULT 'pending',
    download_error      TEXT,
    downloaded_at       TIMESTAMPTZ,
    extracted_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    drive_gid           TEXT,
    drive_folder_gid    TEXT,
    storage_path        TEXT,
    storage_backend     TEXT DEFAULT 'local'
);

CREATE TABLE IF NOT EXISTS amendments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id      UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    change_type         TEXT NOT NULL,
    old_value           TEXT,
    new_value           TEXT,
    detected_at         TIMESTAMPTZ DEFAULT NOW(),
    notified            BOOLEAN DEFAULT FALSE,
    notified_at         TIMESTAMPTZ
);

-- =============================================================================
-- KNOWLEDGE BASE
-- =============================================================================

CREATE TABLE IF NOT EXISTS teaming_partners (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                    TEXT NOT NULL,
    legal_name              TEXT,
    partner_type            TEXT NOT NULL DEFAULT 'subcontractor',
    relationship_status     TEXT DEFAULT 'active',
    uei_number              TEXT,
    cage_code               TEXT,
    sam_registered          BOOLEAN DEFAULT FALSE,
    is_small_business       BOOLEAN DEFAULT FALSE,
    is_sdvosb               BOOLEAN DEFAULT FALSE,
    is_wosb                 BOOLEAN DEFAULT FALSE,
    is_hubzone              BOOLEAN DEFAULT FALSE,
    is_8a                   BOOLEAN DEFAULT FALSE,
    business_size           TEXT,
    naics_codes             TEXT[],
    capabilities_summary    TEXT,
    key_technologies        TEXT[],
    certifications          TEXT[],
    prior_contracts         INT DEFAULT 0,
    teaming_since           DATE,
    poc_name                TEXT,
    poc_email               TEXT,
    poc_phone               TEXT,
    poc_title               TEXT,
    website                 TEXT,
    notes                   TEXT,
    nda_on_file             BOOLEAN DEFAULT FALSE,
    teaming_agreement       BOOLEAN DEFAULT FALSE,
    ta_expiration           DATE,
    active                  BOOLEAN DEFAULT TRUE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS past_performance (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contract_number     TEXT NOT NULL,
    title               TEXT NOT NULL,
    agency              TEXT NOT NULL,
    agency_code         TEXT,
    prime_or_sub        TEXT DEFAULT 'prime',
    contract_type       TEXT,
    naics_code          TEXT,
    period_start        DATE,
    period_end          DATE,
    value_usd           NUMERIC(15,2),
    description         TEXT NOT NULL,
    relevance_domains   TEXT[],
    key_technologies    TEXT[],
    outcomes            TEXT[],
    poc_name            TEXT,
    poc_email           TEXT,
    poc_phone           TEXT,
    clearance_required  BOOLEAN DEFAULT FALSE,
    active              BOOLEAN DEFAULT TRUE,
    partner_id          UUID REFERENCES teaming_partners(id) ON DELETE SET NULL,
    performance_rating  TEXT,
    cpars_rating        TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, contract_number)
);

CREATE TABLE IF NOT EXISTS capabilities (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    domain              TEXT NOT NULL,
    naics_codes         TEXT[],
    maturity_level      TEXT DEFAULT 'proficient',
    years_experience    INT,
    summary             TEXT NOT NULL,
    key_technologies    TEXT[],
    differentiators     TEXT[],
    certifications      TEXT[],
    active              BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, domain)
);

CREATE TABLE IF NOT EXISTS key_personnel (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    full_name           TEXT NOT NULL,
    title               TEXT NOT NULL,
    role_type           TEXT,
    years_experience    INT,
    bio_short           TEXT,
    bio_long            TEXT,
    certifications      TEXT[],
    clearance_level     TEXT,
    domains             TEXT[],
    active              BOOLEAN DEFAULT TRUE,
    affiliation         TEXT DEFAULT 'internal',
    partner_id          UUID REFERENCES teaming_partners(id) ON DELETE SET NULL,
    organization        TEXT,
    email               TEXT,
    phone               TEXT,
    education           TEXT[],
    publications        INT DEFAULT 0,
    labor_category      TEXT,
    hourly_rate         NUMERIC(8,2),
    availability        TEXT DEFAULT 'available',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS boilerplate_sections (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    section_key         TEXT NOT NULL,
    title               TEXT NOT NULL,
    content             TEXT NOT NULL,
    last_updated        DATE,
    version             INT DEFAULT 1,
    active              BOOLEAN DEFAULT TRUE,
    category            TEXT DEFAULT 'general',
    word_count          INT,
    last_used_at        TIMESTAMPTZ,
    usage_count         INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, section_key)
);

-- =============================================================================
-- CONTENT LIBRARY — Focus Area Junction Tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS focus_areas (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT,
    naics_codes         TEXT[],
    keywords            TEXT[],
    status              TEXT DEFAULT 'active',
    sort_order          INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE TABLE IF NOT EXISTS tenant_uploads (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    uploaded_by         TEXT NOT NULL REFERENCES users(id),
    filename            TEXT NOT NULL,
    original_filename   TEXT NOT NULL,
    file_path           TEXT NOT NULL,
    file_size_bytes     BIGINT,
    mime_type           TEXT,
    upload_type         TEXT DEFAULT 'general',
    description         TEXT,
    is_active           BOOLEAN DEFAULT TRUE,
    focus_area_id       UUID REFERENCES focus_areas(id) ON DELETE SET NULL,
    linked_record_type  TEXT,
    linked_record_id    UUID,
    extracted_text      TEXT,
    processed           BOOLEAN DEFAULT FALSE,
    processed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS past_performance_focus_areas (
    past_performance_id UUID REFERENCES past_performance(id) ON DELETE CASCADE,
    focus_area_id       UUID REFERENCES focus_areas(id) ON DELETE CASCADE,
    PRIMARY KEY (past_performance_id, focus_area_id)
);

CREATE TABLE IF NOT EXISTS capability_focus_areas (
    capability_id       UUID REFERENCES capabilities(id) ON DELETE CASCADE,
    focus_area_id       UUID REFERENCES focus_areas(id) ON DELETE CASCADE,
    PRIMARY KEY (capability_id, focus_area_id)
);

CREATE TABLE IF NOT EXISTS personnel_focus_areas (
    personnel_id        UUID REFERENCES key_personnel(id) ON DELETE CASCADE,
    focus_area_id       UUID REFERENCES focus_areas(id) ON DELETE CASCADE,
    role_in_area        TEXT,
    PRIMARY KEY (personnel_id, focus_area_id)
);

CREATE TABLE IF NOT EXISTS partner_focus_areas (
    partner_id          UUID REFERENCES teaming_partners(id) ON DELETE CASCADE,
    focus_area_id       UUID REFERENCES focus_areas(id) ON DELETE CASCADE,
    partner_role        TEXT,
    PRIMARY KEY (partner_id, focus_area_id)
);

CREATE TABLE IF NOT EXISTS boilerplate_focus_areas (
    boilerplate_id      UUID REFERENCES boilerplate_sections(id) ON DELETE CASCADE,
    focus_area_id       UUID REFERENCES focus_areas(id) ON DELETE CASCADE,
    PRIMARY KEY (boilerplate_id, focus_area_id)
);

-- =============================================================================
-- FILES & STORAGE
-- =============================================================================

CREATE TABLE IF NOT EXISTS stored_files (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    gid                 TEXT UNIQUE,
    name                TEXT NOT NULL,
    type                TEXT NOT NULL,
    mime_type           TEXT,
    tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE,
    parent_gid          TEXT,
    web_view_link       TEXT,
    download_link       TEXT,
    permissions         JSONB DEFAULT '[]',
    is_processed        BOOLEAN DEFAULT false,
    auto_created        BOOLEAN DEFAULT false,
    opportunity_id      UUID REFERENCES opportunities(id),
    artifact_type       TEXT,
    artifact_scope      TEXT,
    product_tier        TEXT,
    version             INTEGER DEFAULT 1,
    content_hash        TEXT,
    last_synced_at      TIMESTAMPTZ,
    week_label          TEXT,
    storage_path        TEXT,
    file_size_bytes     BIGINT,
    storage_backend     TEXT DEFAULT 'local',
    created_at          TIMESTAMPTZ DEFAULT now(),
    updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_log (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    tenant_id           UUID REFERENCES tenants(id) ON DELETE SET NULL,
    message_id          TEXT UNIQUE,
    thread_id           TEXT,
    recipient           TEXT NOT NULL,
    subject             TEXT,
    body_preview        TEXT,
    email_type          TEXT NOT NULL,
    sent_at             TIMESTAMPTZ DEFAULT now(),
    delivery_status     TEXT DEFAULT 'sent'
);

CREATE TABLE IF NOT EXISTS integration_executions (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    function_name       TEXT NOT NULL,
    tenant_id           UUID REFERENCES tenants(id) ON DELETE SET NULL,
    status              TEXT DEFAULT 'STARTED',
    started_at          TIMESTAMPTZ DEFAULT now(),
    completed_at        TIMESTAMPTZ,
    success             BOOLEAN,
    duration_ms         INTEGER,
    error_message       TEXT,
    parameters          JSONB,
    result              JSONB
);

-- =============================================================================
-- INDEXES — Opportunities & Knowledge Base
-- =============================================================================

-- Opportunities
CREATE INDEX IF NOT EXISTS idx_opp_source ON opportunities(source, status);
CREATE INDEX IF NOT EXISTS idx_opp_close_date ON opportunities(close_date) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_opp_naics ON opportunities USING GIN(naics_codes);
CREATE INDEX IF NOT EXISTS idx_opp_type ON opportunities(opportunity_type);
CREATE INDEX IF NOT EXISTS idx_opp_hash ON opportunities(content_hash);
CREATE INDEX IF NOT EXISTS idx_opp_fts ON opportunities USING GIN(to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(description,'')));
CREATE INDEX IF NOT EXISTS idx_opp_psc ON opportunities(classification_code) WHERE classification_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_department ON opportunities(department);
CREATE INDEX IF NOT EXISTS idx_opp_pop_state ON opportunities(pop_state) WHERE pop_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_award_amount ON opportunities(award_amount) WHERE award_amount IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_awardee ON opportunities(awardee_name) WHERE awardee_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_contact_email ON opportunities(contact_email) WHERE contact_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_is_active ON opportunities(is_active);

-- Tenant opportunities
CREATE INDEX IF NOT EXISTS idx_to_tenant ON tenant_opportunities(tenant_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_to_opportunity ON tenant_opportunities(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_to_pursuit ON tenant_opportunities(tenant_id, pursuit_status);
CREATE INDEX IF NOT EXISTS idx_to_score ON tenant_opportunities(tenant_id, total_score DESC) WHERE total_score IS NOT NULL;

-- Tenant actions
CREATE INDEX IF NOT EXISTS idx_actions_tenant ON tenant_actions(tenant_id, opportunity_id);
CREATE INDEX IF NOT EXISTS idx_actions_type ON tenant_actions(tenant_id, action_type, created_at DESC);

-- Documents & amendments
CREATE INDEX IF NOT EXISTS idx_docs_opp ON documents(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_docs_status ON documents(download_status) WHERE download_status = 'pending';
CREATE INDEX IF NOT EXISTS idx_docs_drive ON documents(drive_gid) WHERE drive_gid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_docs_storage ON documents(storage_path) WHERE storage_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_amendments_opp ON amendments(opportunity_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_amendments_unnotified ON amendments(notified) WHERE notified = FALSE;

-- Knowledge base
CREATE INDEX IF NOT EXISTS idx_pp_tenant ON past_performance(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_pp_naics ON past_performance(naics_code);
CREATE INDEX IF NOT EXISTS idx_pp_domains ON past_performance USING GIN(relevance_domains);
CREATE INDEX IF NOT EXISTS idx_pp_partner ON past_performance(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cap_tenant ON capabilities(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_personnel_tenant ON key_personnel(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_personnel_partner ON key_personnel(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_personnel_affil ON key_personnel(tenant_id, affiliation);

-- Focus areas & content library
CREATE INDEX IF NOT EXISTS idx_focus_tenant ON focus_areas(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_focus_naics ON focus_areas USING GIN(naics_codes);
CREATE INDEX IF NOT EXISTS idx_partner_tenant ON teaming_partners(tenant_id, active);
CREATE INDEX IF NOT EXISTS idx_partner_type ON teaming_partners(tenant_id, partner_type);
CREATE INDEX IF NOT EXISTS idx_partner_naics ON teaming_partners USING GIN(naics_codes);

-- Uploads
CREATE INDEX IF NOT EXISTS idx_uploads_tenant ON tenant_uploads(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_uploads_focus ON tenant_uploads(focus_area_id) WHERE focus_area_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_uploads_linked ON tenant_uploads(linked_record_type, linked_record_id) WHERE linked_record_id IS NOT NULL;

-- Files & storage
CREATE INDEX IF NOT EXISTS idx_drive_files_tenant ON stored_files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_drive_files_parent ON stored_files(parent_gid);
CREATE INDEX IF NOT EXISTS idx_drive_files_gid ON stored_files(gid);
CREATE INDEX IF NOT EXISTS idx_drive_files_opp ON stored_files(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drive_files_artifact ON stored_files(artifact_type);
CREATE INDEX IF NOT EXISTS idx_drive_files_scope ON stored_files(artifact_scope, product_tier);
CREATE INDEX IF NOT EXISTS idx_drive_files_week ON stored_files(week_label) WHERE week_label IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stored_files_path ON stored_files(storage_path) WHERE storage_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stored_files_backend ON stored_files(storage_backend);
CREATE INDEX IF NOT EXISTS idx_integration_exec_tenant ON integration_executions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_integration_exec_func ON integration_executions(function_name);

-- =============================================================================
-- TRIGGERS — Opportunities & Knowledge Base
-- =============================================================================

CREATE TRIGGER trg_opp_updated_at BEFORE UPDATE ON opportunities
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_focus_updated_at BEFORE UPDATE ON focus_areas
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_partner_updated_at BEFORE UPDATE ON teaming_partners
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_personnel_updated_at BEFORE UPDATE ON key_personnel
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
