-- =============================================================================
-- Migration 001 — Auth & Multi-Tenant Foundation
-- NextAuth.js tables + tenant/user model
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- NEXTAUTH.JS REQUIRED TABLES
-- These exact names/columns are required by Auth.js Postgres adapter
-- =============================================================================

CREATE TABLE users (
    id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name                TEXT,
    email               TEXT UNIQUE,
    email_verified      TIMESTAMPTZ,
    image               TEXT,
    -- Extended fields (beyond NextAuth minimum)
    role                TEXT NOT NULL DEFAULT 'tenant_user',
                        -- 'master_admin' | 'tenant_admin' | 'tenant_user'
    tenant_id           UUID,                    -- NULL for master_admin
    password_hash       TEXT,                    -- For email/password auth
    temp_password       BOOLEAN DEFAULT FALSE,   -- Force reset on first login
    is_active           BOOLEAN DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE accounts (
    id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                 TEXT NOT NULL,
    provider             TEXT NOT NULL,
    provider_account_id  TEXT NOT NULL,
    refresh_token        TEXT,
    access_token         TEXT,
    expires_at           BIGINT,
    token_type           TEXT,
    scope                TEXT,
    id_token             TEXT,
    session_state        TEXT,
    UNIQUE(provider, provider_account_id)
);

CREATE TABLE sessions (
    id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    session_token  TEXT UNIQUE NOT NULL,
    user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires        TIMESTAMPTZ NOT NULL
);

CREATE TABLE verification_tokens (
    identifier  TEXT NOT NULL,
    token       TEXT UNIQUE NOT NULL,
    expires     TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (identifier, token)
);

-- =============================================================================
-- TENANTS
-- One row per customer company. You are also a tenant (Customer #1).
-- =============================================================================

CREATE TABLE tenants (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug                TEXT UNIQUE NOT NULL,    -- URL-safe: 'acme-tech'
    name                TEXT NOT NULL,           -- Display: 'Acme Technology Solutions'
    legal_name          TEXT,
    plan                TEXT NOT NULL DEFAULT 'starter',
                        -- 'starter' | 'professional' | 'enterprise'
    status              TEXT NOT NULL DEFAULT 'active',
                        -- 'active' | 'suspended' | 'churned' | 'trial'
    -- Contact
    primary_email       TEXT,
    primary_phone       TEXT,
    website             TEXT,
    -- Registration
    uei_number          TEXT,                    -- SAM.gov Unique Entity ID
    cage_code           TEXT,
    sam_registered      BOOLEAN DEFAULT FALSE,
    -- Admin notes (only visible to master_admin)
    internal_notes      TEXT,
    onboarded_at        TIMESTAMPTZ,
    trial_ends_at       TIMESTAMPTZ,
    -- Feature access (per-tenant feature flags)
    features            JSONB DEFAULT '{}',
    -- Billing (placeholder for future)
    billing_email       TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Forward reference: users.tenant_id → tenants.id
ALTER TABLE users ADD CONSTRAINT fk_users_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX idx_tenants_slug   ON tenants(slug);
CREATE INDEX idx_tenants_status ON tenants(status);
CREATE INDEX idx_users_tenant   ON users(tenant_id);
CREATE INDEX idx_users_email    ON users(email);

-- =============================================================================
-- TENANT PROFILES
-- Per-tenant configuration for the scoring engine.
-- Admin writes this; eventually tenants self-serve.
-- Replaces global profile.yaml from v1.
-- =============================================================================

CREATE TABLE tenant_profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    -- NAICS
    primary_naics       TEXT[],                  -- Highest-weight matches
    secondary_naics     TEXT[],                  -- Lower-weight matches
    -- Keywords by domain (JSONB: { domain: [keywords] })
    keyword_domains     JSONB DEFAULT '{}',
    -- Set-aside qualifications
    is_small_business   BOOLEAN DEFAULT TRUE,
    is_sdvosb           BOOLEAN DEFAULT FALSE,
    is_wosb             BOOLEAN DEFAULT FALSE,
    is_hubzone          BOOLEAN DEFAULT FALSE,
    is_8a               BOOLEAN DEFAULT FALSE,
    -- Agency priorities (JSONB: { agency_code: tier 1-3 })
    agency_priorities   JSONB DEFAULT '{}',
    -- Financial filters
    min_contract_value  NUMERIC(15,2),
    max_contract_value  NUMERIC(15,2),
    -- Score thresholds (override global defaults)
    min_surface_score   INT DEFAULT 40,
    high_priority_score INT DEFAULT 75,
    -- Self-service flag: when true, tenant can edit their own profile
    self_service        BOOLEAN DEFAULT FALSE,
    updated_by          TEXT DEFAULT 'admin',
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- TENANT SET-ASIDE QUALIFICATIONS (normalized)
-- Separate table so set-asides are queryable for scoring
-- =============================================================================

-- =============================================================================
-- DOWNLOAD LINKS
-- Admin-curated links for specific tenants.
-- Not raw URLs — structured, tracked, optionally time-limited.
-- =============================================================================

CREATE TABLE download_links (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    description         TEXT,
    url                 TEXT NOT NULL,
    link_type           TEXT DEFAULT 'resource',
                        -- 'resource' | 'template' | 'guidance' | 'opportunity_doc'
    opportunity_id      UUID,                    -- Optional: linked to specific opp
    is_active           BOOLEAN DEFAULT TRUE,
    expires_at          TIMESTAMPTZ,             -- NULL = never expires
    access_count        INT DEFAULT 0,
    last_accessed_at    TIMESTAMPTZ,
    created_by          TEXT NOT NULL DEFAULT 'admin',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_download_links_tenant ON download_links(tenant_id, is_active);

-- =============================================================================
-- TENANT UPLOADS
-- Files uploaded by tenants (cut sheets, capability docs, etc.)
-- Stored on filesystem; metadata tracked here.
-- =============================================================================

CREATE TABLE tenant_uploads (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    uploaded_by         TEXT NOT NULL REFERENCES users(id),
    filename            TEXT NOT NULL,
    original_filename   TEXT NOT NULL,
    file_path           TEXT NOT NULL,           -- Relative to uploads root
    file_size_bytes     BIGINT,
    mime_type           TEXT,
    upload_type         TEXT DEFAULT 'general',
                        -- 'general' | 'capability_doc' | 'cut_sheet'
                        -- | 'past_performance' | 'personnel_resume'
    description         TEXT,
    is_active           BOOLEAN DEFAULT TRUE,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_uploads_tenant ON tenant_uploads(tenant_id, is_active);

-- =============================================================================
-- AUDIT LOG
-- Every significant action across the platform.
-- =============================================================================

CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     TEXT REFERENCES users(id),
    tenant_id   UUID REFERENCES tenants(id),
    action      TEXT NOT NULL,
                -- 'tenant.created' | 'tenant.suspended' | 'user.created'
                -- | 'link.created' | 'upload.deleted' | 'impersonate.start' etc.
    entity_type TEXT,
    entity_id   TEXT,
    old_value   JSONB,
    new_value   JSONB,
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_audit_user   ON audit_log(user_id, created_at DESC);

-- =============================================================================
-- SEED: Master admin user + your company as Tenant #1
-- Passwords set via scripts/seed_admin.ts after migration
-- =============================================================================

INSERT INTO tenants (slug, name, plan, status, internal_notes)
VALUES ('my-company', 'My Company (Admin)', 'enterprise', 'active',
        'Owner account — master admin is also a tenant');

-- Updated_at trigger (reused across tables)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON tenant_profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
