-- 018_sbir_award_data.sql
--
-- SBIR/STTR award history + company directory tables.
-- Populated from CSV uploads (sbir.gov data extracts).
-- Used for: application enrichment, marketing, proposal drafting.
--
-- Purely additive. Idempotent.

-- ============================================================================
-- 1. Company directory (from sbir.gov company CSV)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sbir_companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name    TEXT NOT NULL,
    uei             TEXT,
    duns            TEXT,
    address1        TEXT,
    address2        TEXT,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    country         TEXT,
    company_url     TEXT,
    hubzone_owned   BOOLEAN DEFAULT false,
    woman_owned     BOOLEAN DEFAULT false,
    disadvantaged   BOOLEAN DEFAULT false,
    number_awards   INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sbir_companies_uei
  ON sbir_companies (uei) WHERE uei IS NOT NULL AND uei != '';
CREATE INDEX IF NOT EXISTS idx_sbir_companies_name
  ON sbir_companies USING gin (to_tsvector('english', company_name));
CREATE INDEX IF NOT EXISTS idx_sbir_companies_state
  ON sbir_companies (state);

-- ============================================================================
-- 2. Award history (from sbir.gov award CSV)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sbir_awards (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name          TEXT NOT NULL,
    award_title           TEXT,
    agency                TEXT,
    branch                TEXT,
    phase                 TEXT,
    program               TEXT,
    agency_tracking_number TEXT,
    contract              TEXT,
    proposal_award_date   DATE,
    contract_end_date     DATE,
    solicitation_number   TEXT,
    solicitation_year     TEXT,
    solicitation_close_date DATE,
    proposal_receipt_date DATE,
    date_of_notification  DATE,
    topic_code            TEXT,
    award_year            TEXT,
    award_amount          NUMERIC(15,2),
    uei                   TEXT,
    duns                  TEXT,
    hubzone_owned         BOOLEAN DEFAULT false,
    disadvantaged         BOOLEAN DEFAULT false,
    woman_owned           BOOLEAN DEFAULT false,
    number_employees      INTEGER,
    company_website       TEXT,
    address1              TEXT,
    address2              TEXT,
    city                  TEXT,
    state                 TEXT,
    zip                   TEXT,
    abstract              TEXT,
    contact_name          TEXT,
    contact_title         TEXT,
    contact_phone         TEXT,
    contact_email         TEXT,
    pi_name               TEXT,
    pi_title              TEXT,
    pi_phone              TEXT,
    pi_email              TEXT,
    ri_name               TEXT,
    ri_poc_name           TEXT,
    ri_poc_phone          TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sbir_awards_company
  ON sbir_awards USING gin (to_tsvector('english', company_name));
CREATE INDEX IF NOT EXISTS idx_sbir_awards_uei
  ON sbir_awards (uei) WHERE uei IS NOT NULL AND uei != '';
CREATE INDEX IF NOT EXISTS idx_sbir_awards_agency
  ON sbir_awards (agency, program);
CREATE INDEX IF NOT EXISTS idx_sbir_awards_topic
  ON sbir_awards (topic_code) WHERE topic_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sbir_awards_year
  ON sbir_awards (award_year);
CREATE INDEX IF NOT EXISTS idx_sbir_awards_sol
  ON sbir_awards (solicitation_number) WHERE solicitation_number IS NOT NULL;

-- ============================================================================
-- 3. Upload tracking (dedup for future uploads)
-- ============================================================================

CREATE TABLE IF NOT EXISTS sbir_data_uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename        TEXT NOT NULL,
    file_hash       TEXT NOT NULL,
    file_type       TEXT NOT NULL CHECK (file_type IN ('company', 'award')),
    row_count       INTEGER NOT NULL DEFAULT 0,
    uploaded_by     UUID REFERENCES users(id),
    storage_key     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sbir_uploads_hash
  ON sbir_data_uploads (file_hash);
