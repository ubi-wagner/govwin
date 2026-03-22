-- =============================================================================
-- Migration 010 — Extract ALL SAM.gov metadata into proper columns
--
-- Previously many fields lived only in raw_data JSONB. This migration promotes
-- them to first-class columns for indexing, filtering, and future scoring.
-- Also stores SAM.gov UI link and attachment URLs explicitly.
-- =============================================================================

-- ── New columns on opportunities ──

-- Classification
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS classification_code TEXT;        -- PSC / FSC code (e.g. "D302")

-- Organizational hierarchy
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS department          TEXT;        -- Top-level dept (e.g. "DEPT OF DEFENSE")
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS sub_tier            TEXT;        -- Sub-tier agency
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS office              TEXT;        -- Issuing office
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS organization_type   TEXT;        -- "OFFICE", "DEPARTMENT", etc.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS full_parent_path_code TEXT;      -- Full org code (e.g. "097.DISA.PL8")

-- Place of performance
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS pop_city            TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS pop_state           TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS pop_country         TEXT DEFAULT 'USA';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS pop_zip             TEXT;

-- Office address
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS office_city         TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS office_state        TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS office_zip          TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS office_country      TEXT;

-- Point of contact (primary)
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS contact_name        TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS contact_email       TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS contact_phone       TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS contact_title       TEXT;

-- Award info (populated when opp is awarded)
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS award_date          TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS award_number        TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS award_amount        NUMERIC(15,2);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS awardee_name        TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS awardee_uei         TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS awardee_city        TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS awardee_state       TEXT;

-- Notice lifecycle
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS base_type           TEXT;        -- Original type before amendments
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS archive_type        TEXT;        -- auto15, autocustom, manual
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS archive_date        TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS is_active           BOOLEAN DEFAULT TRUE;

-- Links
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS sam_ui_link         TEXT;        -- Direct SAM.gov page URL
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS additional_info_link TEXT;       -- Extra info URL from notice
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS resource_links      JSONB DEFAULT '[]';  -- Attachment URLs [{name, url, ...}]

-- ── Indexes for new filterable/scoreable columns ──

CREATE INDEX IF NOT EXISTS idx_opp_psc          ON opportunities(classification_code) WHERE classification_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_department    ON opportunities(department);
CREATE INDEX IF NOT EXISTS idx_opp_pop_state     ON opportunities(pop_state) WHERE pop_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_award_amount  ON opportunities(award_amount) WHERE award_amount IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_awardee       ON opportunities(awardee_name) WHERE awardee_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_contact_email ON opportunities(contact_email) WHERE contact_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opp_is_active     ON opportunities(is_active);

-- ── Update existing views to include new columns ──

-- Drop and recreate tenant_pipeline to expose new fields
DROP VIEW IF EXISTS tenant_pipeline CASCADE;

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
    o.department,
    o.sub_tier,
    o.office,
    o.naics_codes,
    o.classification_code,
    o.set_aside_type,
    o.set_aside_code,
    o.opportunity_type,
    o.base_type,
    o.posted_date,
    o.close_date,
    o.archive_date,
    o.estimated_value_min,
    o.estimated_value_max,
    o.source_url,
    o.sam_ui_link,
    o.additional_info_link,
    o.resource_links,
    o.status                    AS opp_status,
    o.is_active,

    -- Place of performance
    o.pop_city,
    o.pop_state,
    o.pop_country,
    o.pop_zip,

    -- Point of contact
    o.contact_name,
    o.contact_email,
    o.contact_phone,
    o.contact_title,

    -- Award info
    o.award_date,
    o.award_number,
    o.award_amount,
    o.awardee_name,
    o.awardee_uei,

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

-- Recreate dependent views that were dropped by CASCADE

DROP VIEW IF EXISTS opportunity_tenant_coverage;
CREATE VIEW opportunity_tenant_coverage AS
SELECT
    o.id,
    o.title,
    o.agency,
    o.department,
    o.opportunity_type,
    o.close_date,
    o.award_amount,
    o.awardee_name,
    COUNT(DISTINCT to2.tenant_id)   AS tenant_count,
    ROUND(AVG(to2.total_score), 1)  AS avg_tenant_score,
    MAX(to2.total_score)            AS max_tenant_score,
    COUNT(*) FILTER (WHERE to2.pursuit_status = 'pursuing') AS pursuing_count
FROM opportunities o
LEFT JOIN tenant_opportunities to2 ON to2.opportunity_id = o.id
WHERE o.status = 'active'
GROUP BY o.id, o.title, o.agency, o.department, o.opportunity_type, o.close_date, o.award_amount, o.awardee_name;

DROP VIEW IF EXISTS tenant_analytics;
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
