-- =============================================================================
-- Migration 003 — Opportunities + Multi-Tenant Scoring
--
-- KEY DESIGN: Opportunities are GLOBAL (one canonical record per source ID).
-- Per-tenant data lives in tenant_opportunities and tenant_actions.
-- One amendment update propagates to all tenants instantly.
-- =============================================================================

-- =============================================================================
-- OPPORTUNITIES — Global canonical records
-- =============================================================================

CREATE TABLE opportunities (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source                TEXT NOT NULL,
    source_id             TEXT NOT NULL,
    title                 TEXT NOT NULL,
    description           TEXT,
    agency                TEXT,
    agency_code           TEXT,
    naics_codes           TEXT[],
    set_aside_type        TEXT,
    set_aside_code        TEXT,
    opportunity_type      TEXT,
    posted_date           TIMESTAMPTZ,
    close_date            TIMESTAMPTZ,
    estimated_value_min   NUMERIC(15,2),
    estimated_value_max   NUMERIC(15,2),
    solicitation_number   TEXT,
    contract_number       TEXT,
    source_url            TEXT,
    document_urls         JSONB DEFAULT '[]',
    content_hash          TEXT NOT NULL,
    status                TEXT DEFAULT 'active',
    raw_data              JSONB,
    -- description_embedding vector(384), -- re-add when pgvector available
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source, source_id)
);

CREATE INDEX idx_opp_source      ON opportunities(source, status);
CREATE INDEX idx_opp_close_date  ON opportunities(close_date) WHERE status = 'active';
CREATE INDEX idx_opp_naics       ON opportunities USING GIN(naics_codes);
CREATE INDEX idx_opp_type        ON opportunities(opportunity_type);
CREATE INDEX idx_opp_hash        ON opportunities(content_hash);
-- idx_opp_embedding -- re-add when pgvector available
CREATE INDEX idx_opp_fts         ON opportunities
    USING GIN(to_tsvector('english', COALESCE(title,'') || ' ' || COALESCE(description,'')));

CREATE TRIGGER trg_opp_updated_at
    BEFORE UPDATE ON opportunities
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- TENANT OPPORTUNITIES
-- Junction table: which opportunities are surfaced for which tenant.
-- Scored PER TENANT against THEIR profile.
-- A single opportunity can appear in multiple tenants' pipelines
-- with different scores based on their NAICS/keywords/agency prefs.
-- =============================================================================

CREATE TABLE tenant_opportunities (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    opportunity_id        UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,

    -- Score breakdown against THIS tenant's profile
    total_score           NUMERIC(5,1),
    naics_score           NUMERIC(5,1),
    keyword_score         NUMERIC(5,1),
    set_aside_score       NUMERIC(5,1),
    agency_score          NUMERIC(5,1),
    type_score            NUMERIC(5,1),
    timeline_score        NUMERIC(5,1),
    llm_adjustment        NUMERIC(5,1) DEFAULT 0,
    llm_rationale         TEXT,
    matched_keywords      TEXT[],
    matched_domains       TEXT[],

    -- Tenant-facing status (set by admin or eventually tenant)
    pursuit_status        TEXT DEFAULT 'unreviewed',
                          -- 'unreviewed' | 'pursuing' | 'monitoring' | 'passed'
    pursuit_recommendation TEXT,  -- 'pursue' | 'monitor' | 'pass'

    -- LLM analysis output
    key_requirements      TEXT[],
    competitive_risks     TEXT[],
    questions_for_rfi     TEXT[],

    -- Display priority tier
    priority_tier         TEXT GENERATED ALWAYS AS (
        CASE WHEN total_score >= 75 THEN 'high'
             WHEN total_score >= 50 THEN 'medium'
             ELSE 'low' END
    ) STORED,

    scored_at             TIMESTAMPTZ DEFAULT NOW(),
    rescored_at           TIMESTAMPTZ,

    UNIQUE(tenant_id, opportunity_id)
);

CREATE INDEX idx_to_tenant       ON tenant_opportunities(tenant_id, total_score DESC);
CREATE INDEX idx_to_opportunity  ON tenant_opportunities(opportunity_id);
CREATE INDEX idx_to_pursuit      ON tenant_opportunities(tenant_id, pursuit_status);
CREATE INDEX idx_to_score        ON tenant_opportunities(tenant_id, total_score DESC)
    WHERE total_score IS NOT NULL;

-- =============================================================================
-- TENANT ACTIONS
-- Thumbs up/down, comments, notes — per tenant per opportunity.
-- This is the feedback signal that will tune scoring over time.
-- =============================================================================

CREATE TABLE tenant_actions (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    opportunity_id    UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    user_id           TEXT NOT NULL REFERENCES users(id),
    action_type       TEXT NOT NULL,
                      -- 'thumbs_up' | 'thumbs_down' | 'comment' | 'note'
                      -- | 'status_change' | 'flag' | 'pin'
    value             TEXT,           -- thumbs: null; comment/note: text content
    metadata          JSONB,          -- e.g. { old_status, new_status } for status_change
    -- Context at time of action (for future scoring tuning)
    score_at_action   NUMERIC(5,1),
    agency_at_action  TEXT,
    type_at_action    TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_actions_tenant ON tenant_actions(tenant_id, opportunity_id);
CREATE INDEX idx_actions_type   ON tenant_actions(tenant_id, action_type, created_at DESC);

-- Materialized summary: quick reaction counts per opp per tenant
CREATE VIEW tenant_opportunity_reactions AS
SELECT
    tenant_id,
    opportunity_id,
    COUNT(*) FILTER (WHERE action_type = 'thumbs_up')   AS thumbs_up,
    COUNT(*) FILTER (WHERE action_type = 'thumbs_down') AS thumbs_down,
    COUNT(*) FILTER (WHERE action_type = 'comment')     AS comment_count,
    COUNT(*) FILTER (WHERE action_type = 'pin')         AS is_pinned,
    MAX(created_at)                                      AS last_action_at
FROM tenant_actions
GROUP BY tenant_id, opportunity_id;

-- =============================================================================
-- DOCUMENTS — Global per opportunity
-- =============================================================================

CREATE TABLE documents (
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
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_docs_opp    ON documents(opportunity_id);
CREATE INDEX idx_docs_status ON documents(download_status) WHERE download_status = 'pending';

-- =============================================================================
-- AMENDMENTS
-- =============================================================================

CREATE TABLE amendments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id  UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    change_type     TEXT NOT NULL,
    old_value       TEXT,
    new_value       TEXT,
    detected_at     TIMESTAMPTZ DEFAULT NOW(),
    notified        BOOLEAN DEFAULT FALSE,
    notified_at     TIMESTAMPTZ
);

CREATE INDEX idx_amendments_opp       ON amendments(opportunity_id, detected_at DESC);
CREATE INDEX idx_amendments_unnotified ON amendments(notified) WHERE notified = FALSE;

-- =============================================================================
-- PRIMARY VIEW: Tenant pipeline — the main portal query
-- Joins global opportunity + tenant-specific score + reactions
-- =============================================================================

CREATE VIEW tenant_pipeline AS
SELECT
    -- Identity
    to2.id                      AS tenant_opp_id,
    to2.tenant_id,
    o.id                        AS opportunity_id,
    o.source,
    o.source_id,
    o.solicitation_number,
    o.title,
    o.description,
    o.agency,
    o.agency_code,
    o.naics_codes,
    o.set_aside_type,
    o.opportunity_type,
    o.posted_date,
    o.close_date,
    o.estimated_value_min,
    o.estimated_value_max,
    o.source_url,
    o.status                    AS opp_status,

    -- Tenant-specific scoring
    to2.total_score,
    to2.llm_adjustment,
    to2.llm_rationale,
    to2.matched_keywords,
    to2.matched_domains,
    to2.pursuit_status,
    to2.pursuit_recommendation,
    to2.key_requirements,
    to2.competitive_risks,
    to2.questions_for_rfi,
    to2.priority_tier,
    to2.scored_at,

    -- Computed deadline fields
    EXTRACT(DAY FROM (o.close_date - NOW()))::INT AS days_to_close,
    CASE
        WHEN o.close_date < NOW()                          THEN 'closed'
        WHEN o.close_date < NOW() + INTERVAL '7 days'     THEN 'urgent'
        WHEN o.close_date < NOW() + INTERVAL '14 days'    THEN 'soon'
        ELSE 'ok'
    END                         AS deadline_status,

    -- Reactions (from view)
    COALESCE(r.thumbs_up, 0)    AS thumbs_up,
    COALESCE(r.thumbs_down, 0)  AS thumbs_down,
    COALESCE(r.comment_count, 0) AS comment_count,
    COALESCE(r.is_pinned, 0) > 0 AS is_pinned,
    r.last_action_at,

    -- Counts
    (SELECT COUNT(*) FROM documents d WHERE d.opportunity_id = o.id)      AS doc_count,
    (SELECT COUNT(*) FROM amendments a WHERE a.opportunity_id = o.id)     AS amendment_count

FROM tenant_opportunities to2
JOIN opportunities o ON o.id = to2.opportunity_id
LEFT JOIN tenant_opportunity_reactions r
    ON r.tenant_id = to2.tenant_id AND r.opportunity_id = o.id
WHERE o.status = 'active';

-- =============================================================================
-- ADMIN VIEW: Cross-tenant opportunity coverage
-- How many tenants have each opportunity in their pipeline
-- =============================================================================

CREATE VIEW opportunity_tenant_coverage AS
SELECT
    o.id,
    o.title,
    o.agency,
    o.opportunity_type,
    o.close_date,
    COUNT(DISTINCT to2.tenant_id)   AS tenant_count,
    ROUND(AVG(to2.total_score), 1)  AS avg_tenant_score,
    MAX(to2.total_score)            AS max_tenant_score,
    COUNT(*) FILTER (WHERE to2.pursuit_status = 'pursuing') AS pursuing_count
FROM opportunities o
LEFT JOIN tenant_opportunities to2 ON to2.opportunity_id = o.id
WHERE o.status = 'active'
GROUP BY o.id, o.title, o.agency, o.opportunity_type, o.close_date;

-- =============================================================================
-- ANALYTICS VIEW — Per-tenant summary stats
-- =============================================================================

CREATE VIEW tenant_analytics AS
SELECT
    tp.tenant_id,
    t.name                                              AS tenant_name,
    COUNT(*)                                            AS total_in_pipeline,
    COUNT(*) FILTER (WHERE tp.total_score >= 75)        AS high_priority_count,
    COUNT(*) FILTER (WHERE tp.pursuit_status = 'pursuing') AS pursuing_count,
    COUNT(*) FILTER (WHERE tp.pursuit_status = 'monitoring') AS monitoring_count,
    ROUND(AVG(tp.total_score), 1)                       AS avg_score,
    COUNT(*) FILTER (WHERE
        o.close_date BETWEEN NOW() AND NOW() + INTERVAL '14 days'
    )                                                   AS closing_14d,
    COUNT(*) FILTER (WHERE
        tp.scored_at > NOW() - INTERVAL '7 days'
    )                                                   AS new_last_7d,
    -- Reaction stats
    SUM(COALESCE(r.thumbs_up, 0))                       AS total_thumbs_up,
    SUM(COALESCE(r.thumbs_down, 0))                     AS total_thumbs_down,
    MAX(tp.scored_at)                                   AS last_scored_at
FROM tenant_opportunities tp
JOIN tenants t ON t.id = tp.tenant_id
JOIN opportunities o ON o.id = tp.opportunity_id
LEFT JOIN tenant_opportunity_reactions r
    ON r.tenant_id = tp.tenant_id AND r.opportunity_id = tp.opportunity_id
WHERE o.status = 'active'
GROUP BY tp.tenant_id, t.name;
