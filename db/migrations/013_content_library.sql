-- =============================================================================
-- Migration 013 — Content Library Expansion
--
-- Adds focus_areas, teaming_partners, junction tables, and enriches
-- key_personnel + tenant_uploads to support the full proposal engine.
--
-- Design principles:
--   - Everything is tenant-scoped (tenant_id FK with ON DELETE CASCADE)
--   - Focus areas are the organizing spine — all content links to them
--   - Key personnel includes both internal staff and partner personnel
--   - Teaming partners are orgs (subs, mentors, JV partners, universities)
--   - tenant_uploads link to focus areas + specific content records
-- =============================================================================

-- =============================================================================
-- FOCUS AREAS — Strategic domains that organize all content
-- e.g. "Cybersecurity", "Hypersonics R&D", "Cloud Migration"
-- =============================================================================

CREATE TABLE focus_areas (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    naics_codes     TEXT[],               -- NAICS codes relevant to this focus
    keywords        TEXT[],               -- Keywords for matching to opportunities
    status          TEXT DEFAULT 'active', -- 'active' | 'inactive'
    sort_order      INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX idx_focus_tenant ON focus_areas(tenant_id, status);
CREATE INDEX idx_focus_naics  ON focus_areas USING GIN(naics_codes);

CREATE TRIGGER trg_focus_updated_at
    BEFORE UPDATE ON focus_areas
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TEAMING PARTNERS — Organizations (subs, mentors, JV partners, universities)
-- =============================================================================

CREATE TABLE teaming_partners (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    legal_name          TEXT,
    partner_type        TEXT NOT NULL DEFAULT 'subcontractor',
                        -- 'subcontractor' | 'mentor' | 'jv_partner'
                        -- | 'university' | 'lab' | 'consultant' | 'prime'
    relationship_status TEXT DEFAULT 'active',
                        -- 'active' | 'prospective' | 'inactive' | 'past'
    -- Registration
    uei_number          TEXT,
    cage_code           TEXT,
    sam_registered      BOOLEAN DEFAULT FALSE,
    -- Set-aside qualifications (matters for teaming arrangements)
    is_small_business   BOOLEAN DEFAULT FALSE,
    is_sdvosb           BOOLEAN DEFAULT FALSE,
    is_wosb             BOOLEAN DEFAULT FALSE,
    is_hubzone          BOOLEAN DEFAULT FALSE,
    is_8a               BOOLEAN DEFAULT FALSE,
    business_size       TEXT,             -- 'small' | 'large' | 'other'
    -- Capabilities
    naics_codes         TEXT[],
    capabilities_summary TEXT,
    key_technologies    TEXT[],
    certifications      TEXT[],
    -- Past work together
    prior_contracts     INT DEFAULT 0,    -- How many contracts worked together
    teaming_since       DATE,             -- Relationship start date
    -- Contact
    poc_name            TEXT,
    poc_email           TEXT,
    poc_phone           TEXT,
    poc_title           TEXT,
    website             TEXT,
    -- Notes
    notes               TEXT,
    -- Agreements
    nda_on_file         BOOLEAN DEFAULT FALSE,
    teaming_agreement   BOOLEAN DEFAULT FALSE,
    ta_expiration       DATE,             -- Teaming agreement expiration
    active              BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, name)
);

CREATE INDEX idx_partner_tenant ON teaming_partners(tenant_id, active);
CREATE INDEX idx_partner_type   ON teaming_partners(tenant_id, partner_type);
CREATE INDEX idx_partner_naics  ON teaming_partners USING GIN(naics_codes);

CREATE TRIGGER trg_partner_updated_at
    BEFORE UPDATE ON teaming_partners
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- KEY PERSONNEL — Add affiliation + partner link
-- Internal staff have affiliation='internal', partner_id=NULL
-- Partner staff have affiliation='partner', partner_id=<their org>
-- =============================================================================

ALTER TABLE key_personnel
    ADD COLUMN affiliation     TEXT DEFAULT 'internal',
                               -- 'internal' | 'partner' | 'consultant' | 'advisor'
    ADD COLUMN partner_id      UUID REFERENCES teaming_partners(id) ON DELETE SET NULL,
    ADD COLUMN organization    TEXT,     -- Display name (auto-filled from partner if linked)
    ADD COLUMN email           TEXT,
    ADD COLUMN phone           TEXT,
    ADD COLUMN education       TEXT[],   -- Degrees: 'PhD Aerospace Engineering, MIT'
    ADD COLUMN publications    INT DEFAULT 0,  -- Publication count (relevant for SBIR)
    ADD COLUMN labor_category  TEXT,     -- 'PI' | 'co-PI' | 'PM' | 'SME' | 'engineer' etc.
    ADD COLUMN hourly_rate     NUMERIC(8,2),   -- For cost volume planning
    ADD COLUMN availability    TEXT DEFAULT 'available',
                               -- 'available' | 'committed' | 'partial' | 'unavailable'
    ADD COLUMN updated_at      TIMESTAMPTZ DEFAULT NOW();

CREATE INDEX idx_personnel_partner ON key_personnel(partner_id) WHERE partner_id IS NOT NULL;
CREATE INDEX idx_personnel_affil   ON key_personnel(tenant_id, affiliation);

CREATE TRIGGER trg_personnel_updated_at
    BEFORE UPDATE ON key_personnel
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- JUNCTION TABLES — Link content to focus areas
-- =============================================================================

-- Past Performance ↔ Focus Areas
CREATE TABLE past_performance_focus_areas (
    past_performance_id UUID NOT NULL REFERENCES past_performance(id) ON DELETE CASCADE,
    focus_area_id       UUID NOT NULL REFERENCES focus_areas(id) ON DELETE CASCADE,
    PRIMARY KEY (past_performance_id, focus_area_id)
);

-- Capabilities ↔ Focus Areas
CREATE TABLE capability_focus_areas (
    capability_id       UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    focus_area_id       UUID NOT NULL REFERENCES focus_areas(id) ON DELETE CASCADE,
    PRIMARY KEY (capability_id, focus_area_id)
);

-- Key Personnel ↔ Focus Areas
CREATE TABLE personnel_focus_areas (
    personnel_id        UUID NOT NULL REFERENCES key_personnel(id) ON DELETE CASCADE,
    focus_area_id       UUID NOT NULL REFERENCES focus_areas(id) ON DELETE CASCADE,
    role_in_area        TEXT,  -- 'PI' | 'lead' | 'contributor' | 'advisor'
    PRIMARY KEY (personnel_id, focus_area_id)
);

-- Teaming Partners ↔ Focus Areas
CREATE TABLE partner_focus_areas (
    partner_id          UUID NOT NULL REFERENCES teaming_partners(id) ON DELETE CASCADE,
    focus_area_id       UUID NOT NULL REFERENCES focus_areas(id) ON DELETE CASCADE,
    partner_role        TEXT,  -- 'sub' | 'mentor' | 'research_partner' | 'manufacturing'
    PRIMARY KEY (partner_id, focus_area_id)
);

-- Boilerplate Sections ↔ Focus Areas
CREATE TABLE boilerplate_focus_areas (
    boilerplate_id      UUID NOT NULL REFERENCES boilerplate_sections(id) ON DELETE CASCADE,
    focus_area_id       UUID NOT NULL REFERENCES focus_areas(id) ON DELETE CASCADE,
    PRIMARY KEY (boilerplate_id, focus_area_id)
);

-- =============================================================================
-- TENANT UPLOADS — Link to focus areas + content records
-- =============================================================================

ALTER TABLE tenant_uploads
    ADD COLUMN focus_area_id       UUID REFERENCES focus_areas(id) ON DELETE SET NULL,
    ADD COLUMN linked_record_type  TEXT,
                                   -- 'past_performance' | 'capability' | 'personnel'
                                   -- | 'partner' | 'boilerplate'
    ADD COLUMN linked_record_id    UUID,
    ADD COLUMN extracted_text      TEXT,        -- Extracted text content (for search/RAG)
    ADD COLUMN processed           BOOLEAN DEFAULT FALSE,
    ADD COLUMN processed_at        TIMESTAMPTZ;

CREATE INDEX idx_uploads_focus ON tenant_uploads(focus_area_id) WHERE focus_area_id IS NOT NULL;
CREATE INDEX idx_uploads_linked ON tenant_uploads(linked_record_type, linked_record_id)
    WHERE linked_record_id IS NOT NULL;

-- =============================================================================
-- PAST PERFORMANCE — Add partner link for sub work
-- =============================================================================

ALTER TABLE past_performance
    ADD COLUMN partner_id       UUID REFERENCES teaming_partners(id) ON DELETE SET NULL,
    ADD COLUMN performance_rating TEXT,  -- 'exceptional' | 'very_good' | 'satisfactory' | 'marginal' | 'unsatisfactory'
    ADD COLUMN cpars_rating     TEXT;    -- CPARS rating if available

CREATE INDEX idx_pp_partner ON past_performance(partner_id) WHERE partner_id IS NOT NULL;

-- =============================================================================
-- BOILERPLATE SECTIONS — Add category for better organization
-- =============================================================================

ALTER TABLE boilerplate_sections
    ADD COLUMN category         TEXT DEFAULT 'general',
                                -- 'technical_approach' | 'management_approach'
                                -- | 'past_performance' | 'staffing' | 'quality'
                                -- | 'security' | 'transition' | 'general'
    ADD COLUMN word_count       INT,
    ADD COLUMN last_used_at     TIMESTAMPTZ,
    ADD COLUMN usage_count      INT DEFAULT 0;

-- =============================================================================
-- VIEW: Content Library Summary — Per-tenant content inventory
-- =============================================================================

CREATE VIEW tenant_content_summary AS
SELECT
    t.id                                                AS tenant_id,
    t.name                                              AS tenant_name,
    (SELECT COUNT(*) FROM focus_areas fa
        WHERE fa.tenant_id = t.id AND fa.status = 'active')    AS focus_area_count,
    (SELECT COUNT(*) FROM past_performance pp
        WHERE pp.tenant_id = t.id AND pp.active)               AS past_performance_count,
    (SELECT COUNT(*) FROM capabilities c
        WHERE c.tenant_id = t.id AND c.active)                 AS capability_count,
    (SELECT COUNT(*) FROM key_personnel kp
        WHERE kp.tenant_id = t.id AND kp.active
        AND kp.affiliation = 'internal')                       AS internal_personnel_count,
    (SELECT COUNT(*) FROM key_personnel kp
        WHERE kp.tenant_id = t.id AND kp.active
        AND kp.affiliation != 'internal')                      AS partner_personnel_count,
    (SELECT COUNT(*) FROM teaming_partners tp
        WHERE tp.tenant_id = t.id AND tp.active)               AS teaming_partner_count,
    (SELECT COUNT(*) FROM boilerplate_sections bs
        WHERE bs.tenant_id = t.id AND bs.active)               AS boilerplate_count,
    (SELECT COUNT(*) FROM tenant_uploads tu
        WHERE tu.tenant_id = t.id AND tu.is_active)            AS upload_count
FROM tenants t
WHERE t.status = 'active';

-- =============================================================================
-- VIEW: Focus Area Detail — Everything linked to a focus area
-- =============================================================================

CREATE VIEW focus_area_content AS
SELECT
    fa.id                                               AS focus_area_id,
    fa.tenant_id,
    fa.name                                             AS focus_area_name,
    fa.naics_codes,
    fa.keywords,
    (SELECT COUNT(*) FROM past_performance_focus_areas ppfa
        WHERE ppfa.focus_area_id = fa.id)               AS past_performance_count,
    (SELECT COUNT(*) FROM capability_focus_areas cfa
        WHERE cfa.focus_area_id = fa.id)                AS capability_count,
    (SELECT COUNT(*) FROM personnel_focus_areas pfa
        WHERE pfa.focus_area_id = fa.id)                AS personnel_count,
    (SELECT COUNT(*) FROM partner_focus_areas parfa
        WHERE parfa.focus_area_id = fa.id)              AS partner_count,
    (SELECT COUNT(*) FROM boilerplate_focus_areas bfa
        WHERE bfa.focus_area_id = fa.id)                AS boilerplate_count,
    (SELECT COUNT(*) FROM tenant_uploads tu
        WHERE tu.focus_area_id = fa.id AND tu.is_active) AS upload_count
FROM focus_areas fa
WHERE fa.status = 'active';
