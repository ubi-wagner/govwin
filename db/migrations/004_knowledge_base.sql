-- =============================================================================
-- Migration 004 — Knowledge Base (Per-Tenant)
-- Past performance, capabilities, personnel — Phase 2 proposal engine
-- All scoped to tenant_id — each company has their own KB
-- =============================================================================

CREATE TABLE past_performance (
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
    embedding           vector(384),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, contract_number)
);

CREATE INDEX idx_pp_tenant   ON past_performance(tenant_id, active);
CREATE INDEX idx_pp_naics    ON past_performance(naics_code);
CREATE INDEX idx_pp_domains  ON past_performance USING GIN(relevance_domains);

CREATE TABLE capabilities (
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
    embedding           vector(384),
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, domain)
);

CREATE INDEX idx_cap_tenant ON capabilities(tenant_id, active);

CREATE TABLE key_personnel (
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
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_personnel_tenant ON key_personnel(tenant_id, active);

CREATE TABLE boilerplate_sections (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    section_key     TEXT NOT NULL,
    title           TEXT NOT NULL,
    content         TEXT NOT NULL,
    last_updated    DATE,
    version         INT DEFAULT 1,
    active          BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, section_key)
);
