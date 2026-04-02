-- Migration 033: SBIR.gov Data Tables
-- New tables for SBIR.gov award history and company intelligence.
-- Solicitations/topics flow into the existing opportunities table.

BEGIN;

-- ── SBIR Awards ──────────────────────────────────────────────────────
-- Historical and current SBIR/STTR awards from SBIR.gov API.
-- Used for competitive intelligence, company research, and past performance.
CREATE TABLE IF NOT EXISTS sbir_awards (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       TEXT NOT NULL,  -- SBIR.gov award ID / agency_tracking_number
    firm            TEXT NOT NULL,
    award_title     TEXT,
    agency          TEXT,
    branch          TEXT,
    phase           TEXT,           -- Phase I, Phase II, Phase III
    program         TEXT,           -- SBIR or STTR
    agency_tracking_number TEXT,
    contract        TEXT,
    proposal_award_date DATE,
    contract_end_date DATE,
    solicitation_number TEXT,
    solicitation_year TEXT,
    topic_code      TEXT,
    award_year      INT,
    award_amount    NUMERIC(14,2),
    duns            TEXT,
    uei             TEXT,
    hubzone_owned   TEXT,
    socially_economically_disadvantaged TEXT,
    women_owned     TEXT,
    number_employees INT,
    company_url     TEXT,
    address1        TEXT,
    address2        TEXT,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    poc_name        TEXT,
    poc_title       TEXT,
    poc_phone       TEXT,
    poc_email       TEXT,
    pi_name         TEXT,           -- Principal Investigator
    pi_phone        TEXT,
    pi_email        TEXT,
    ri_name         TEXT,           -- Research Institution (STTR)
    ri_poc_name     TEXT,
    ri_poc_phone    TEXT,
    research_keywords TEXT,
    abstract        TEXT,
    award_link      TEXT,
    content_hash    TEXT,
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_id)
);

CREATE INDEX IF NOT EXISTS idx_sbir_awards_firm ON sbir_awards(firm);
CREATE INDEX IF NOT EXISTS idx_sbir_awards_agency ON sbir_awards(agency);
CREATE INDEX IF NOT EXISTS idx_sbir_awards_topic ON sbir_awards(topic_code);
CREATE INDEX IF NOT EXISTS idx_sbir_awards_year ON sbir_awards(award_year);
CREATE INDEX IF NOT EXISTS idx_sbir_awards_uei ON sbir_awards(uei);
CREATE INDEX IF NOT EXISTS idx_sbir_awards_program ON sbir_awards(program);
CREATE INDEX IF NOT EXISTS idx_sbir_awards_phase ON sbir_awards(phase);

-- ── SBIR Companies ───────────────────────────────────────────────────
-- Company profiles from SBIR.gov API — firms that have won SBIR/STTR awards.
-- Used for competitive landscape, teaming partner discovery, and market intel.
CREATE TABLE IF NOT EXISTS sbir_companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id       TEXT NOT NULL,  -- SBIR.gov firm_nid
    company_name    TEXT NOT NULL,
    sbir_url        TEXT,
    uei             TEXT,
    duns            TEXT,
    address         TEXT,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    company_url     TEXT,
    hubzone_owned   TEXT,
    socially_economically_disadvantaged TEXT,
    woman_owned     TEXT,
    number_awards   INT,
    content_hash    TEXT,
    raw_data        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_id)
);

CREATE INDEX IF NOT EXISTS idx_sbir_companies_name ON sbir_companies(company_name);
CREATE INDEX IF NOT EXISTS idx_sbir_companies_state ON sbir_companies(state);
CREATE INDEX IF NOT EXISTS idx_sbir_companies_uei ON sbir_companies(uei);

-- ── Pipeline schedule for SBIR.gov ───────────────────────────────────
INSERT INTO pipeline_schedules (source, display_name, run_type, cron_expression, enabled, priority)
VALUES
    ('sbir_gov_solicitations', 'SBIR.gov Solicitations Scan', 'full', '0 7 * * *', TRUE, 20),
    ('sbir_gov_awards',        'SBIR.gov Awards Sync',        'full', '0 3 * * 0', TRUE, 30),
    ('sbir_gov_companies',     'SBIR.gov Companies Sync',     'full', '0 4 * * 0', TRUE, 30)
ON CONFLICT DO NOTHING;

-- ── Source health entries ─────────────────────────────────────────────
INSERT INTO source_health (source, display_name, status)
VALUES
    ('sbir_gov_solicitations', 'SBIR.gov Solicitations', 'unknown'),
    ('sbir_gov_awards',        'SBIR.gov Awards',        'unknown'),
    ('sbir_gov_companies',     'SBIR.gov Companies',     'unknown')
ON CONFLICT DO NOTHING;

COMMIT;
