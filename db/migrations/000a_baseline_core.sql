-- =============================================================================
-- 000a — Core Foundation: Extensions, Auth, Tenants, Infrastructure
-- Part 1 of 4 baseline migrations (consolidated from 001-022)
-- =============================================================================

-- ─── Extensions ─────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Generic Trigger Function ───────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- AUTH TABLES (NextAuth.js required)
-- =============================================================================

CREATE TABLE IF NOT EXISTS users (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name                    TEXT,
    email                   TEXT UNIQUE,
    email_verified          TIMESTAMPTZ,
    image                   TEXT,
    role                    TEXT NOT NULL DEFAULT 'tenant_user',
    tenant_id               UUID,
    password_hash           TEXT,
    temp_password           BOOLEAN DEFAULT FALSE,
    is_active               BOOLEAN DEFAULT TRUE,
    last_login_at           TIMESTAMPTZ,
    terms_accepted_at       TIMESTAMPTZ,
    terms_version           TEXT,
    privacy_accepted_at     TIMESTAMPTZ,
    authority_confirmed_at  TIMESTAMPTZ,
    consent_required        BOOLEAN DEFAULT FALSE,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounts (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type                    TEXT NOT NULL,
    provider                TEXT NOT NULL,
    provider_account_id     TEXT NOT NULL,
    refresh_token           TEXT,
    access_token            TEXT,
    expires_at              BIGINT,
    token_type              TEXT,
    scope                   TEXT,
    id_token                TEXT,
    session_state           TEXT,
    UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    session_token           TEXT NOT NULL UNIQUE,
    user_id                 TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires                 TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_tokens (
    identifier              TEXT NOT NULL,
    token                   TEXT NOT NULL UNIQUE,
    expires                 TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (identifier, token)
);

-- =============================================================================
-- TENANTS & PROFILES
-- =============================================================================

CREATE TABLE IF NOT EXISTS tenants (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug                        TEXT NOT NULL UNIQUE,
    name                        TEXT NOT NULL,
    legal_name                  TEXT,
    plan                        TEXT NOT NULL DEFAULT 'starter',
    status                      TEXT NOT NULL DEFAULT 'active',
    primary_email               TEXT,
    primary_phone               TEXT,
    website                     TEXT,
    uei_number                  TEXT,
    cage_code                   TEXT,
    sam_registered              BOOLEAN DEFAULT FALSE,
    internal_notes              TEXT,
    onboarded_at                TIMESTAMPTZ,
    trial_ends_at               TIMESTAMPTZ,
    features                    JSONB DEFAULT '{}',
    billing_email               TEXT,
    drive_folder_id             TEXT,
    gmail_thread_label_id       TEXT,
    onboarding_step             TEXT DEFAULT 'pending',
    product_tier                TEXT DEFAULT 'finder',
    max_active_opps             INTEGER DEFAULT 10,
    drive_finder_folder_id      TEXT,
    drive_reminders_folder_id   TEXT,
    drive_binder_folder_id      TEXT,
    drive_grinder_folder_id     TEXT,
    drive_uploads_folder_id     TEXT,
    storage_root_path           TEXT,
    storage_finder_path         TEXT,
    storage_reminders_path      TEXT,
    storage_binder_path         TEXT,
    storage_grinder_path        TEXT,
    storage_uploads_path        TEXT,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- FK from users → tenants (circular dependency resolved via ALTER)
ALTER TABLE users ADD CONSTRAINT fk_users_tenant
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS tenant_profiles (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
    primary_naics       TEXT[],
    secondary_naics     TEXT[],
    keyword_domains     JSONB DEFAULT '{}',
    is_small_business   BOOLEAN DEFAULT TRUE,
    is_sdvosb           BOOLEAN DEFAULT FALSE,
    is_wosb             BOOLEAN DEFAULT FALSE,
    is_hubzone          BOOLEAN DEFAULT FALSE,
    is_8a               BOOLEAN DEFAULT FALSE,
    agency_priorities   JSONB DEFAULT '{}',
    min_contract_value  NUMERIC(15,2),
    max_contract_value  NUMERIC(15,2),
    min_surface_score   INT DEFAULT 40,
    high_priority_score INT DEFAULT 75,
    self_service        BOOLEAN DEFAULT FALSE,
    updated_by          TEXT DEFAULT 'admin',
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS download_links (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title               TEXT NOT NULL,
    description         TEXT,
    url                 TEXT NOT NULL,
    link_type           TEXT DEFAULT 'resource',
    opportunity_id      UUID,
    is_active           BOOLEAN DEFAULT TRUE,
    expires_at          TIMESTAMPTZ,
    access_count        INT DEFAULT 0,
    last_accessed_at    TIMESTAMPTZ,
    created_by          TEXT NOT NULL DEFAULT 'admin',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             TEXT REFERENCES users(id),
    tenant_id           UUID REFERENCES tenants(id),
    action              TEXT NOT NULL,
    entity_type         TEXT,
    entity_id           TEXT,
    old_value           JSONB,
    new_value           JSONB,
    ip_address          TEXT,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CONTROL PLANE: Config, API Keys, Pipeline, Rate Limits
-- =============================================================================

CREATE TABLE IF NOT EXISTS system_config (
    key                 TEXT PRIMARY KEY,
    value               JSONB NOT NULL,
    description         TEXT,
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_by          TEXT DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS api_key_registry (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source              TEXT NOT NULL UNIQUE,
    env_var             TEXT NOT NULL,
    key_hint            TEXT,
    issued_date         DATE,
    expires_date        DATE,
    days_warning        INT DEFAULT 15,
    last_validated      TIMESTAMPTZ,
    is_valid            BOOLEAN DEFAULT TRUE,
    notes               TEXT,
    encrypted_value     TEXT,
    issued_by           TEXT,
    rotated_at          TIMESTAMPTZ,
    last_validated_at   TIMESTAMPTZ,
    last_validation_ok  BOOLEAN,
    last_validation_msg TEXT,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pipeline_schedules (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source              TEXT NOT NULL UNIQUE,
    display_name        TEXT NOT NULL,
    run_type            TEXT NOT NULL DEFAULT 'full',
    cron_expression     TEXT NOT NULL,
    timezone            TEXT NOT NULL DEFAULT 'UTC',
    enabled             BOOLEAN DEFAULT TRUE,
    priority            INT DEFAULT 5,
    timeout_minutes     INT DEFAULT 30,
    last_run_at         TIMESTAMPTZ,
    next_run_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rate_limit_state (
    source              TEXT PRIMARY KEY,
    requests_today      INT DEFAULT 0,
    requests_this_hour  INT DEFAULT 0,
    daily_limit         INT,
    hourly_limit        INT,
    window_date         DATE DEFAULT CURRENT_DATE,
    window_hour         INT DEFAULT EXTRACT(HOUR FROM NOW())::INT,
    last_request_at     TIMESTAMPTZ,
    last_reset_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source              TEXT NOT NULL,
    run_type            TEXT NOT NULL DEFAULT 'full',
    status              TEXT NOT NULL DEFAULT 'pending',
    triggered_by        TEXT NOT NULL DEFAULT 'scheduler',
    triggered_at        TIMESTAMPTZ DEFAULT NOW(),
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,
    worker_id           TEXT,
    priority            INT DEFAULT 5,
    attempt             INT DEFAULT 1,
    max_attempts        INT DEFAULT 3,
    parameters          JSONB DEFAULT '{}',
    result              JSONB,
    error_message       TEXT,
    execution_notes     TEXT
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id                  UUID REFERENCES pipeline_jobs(id),
    source                  TEXT NOT NULL,
    run_type                TEXT NOT NULL,
    started_at              TIMESTAMPTZ NOT NULL,
    completed_at            TIMESTAMPTZ,
    duration_seconds        NUMERIC GENERATED ALWAYS AS (EXTRACT(EPOCH FROM (completed_at - started_at))) STORED,
    status                  TEXT NOT NULL,
    opportunities_fetched   INT DEFAULT 0,
    opportunities_new       INT DEFAULT 0,
    opportunities_updated   INT DEFAULT 0,
    tenants_scored          INT DEFAULT 0,
    documents_downloaded    INT DEFAULT 0,
    llm_calls_made          INT DEFAULT 0,
    llm_tokens_used         INT DEFAULT 0,
    llm_cost_usd            NUMERIC(10,4),
    amendments_detected     INT DEFAULT 0,
    errors                  JSONB DEFAULT '[]',
    metadata                JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS source_health (
    source                  TEXT PRIMARY KEY,
    status                  TEXT DEFAULT 'unknown',
    last_success_at         TIMESTAMPTZ,
    last_error_at           TIMESTAMPTZ,
    last_error_message      TEXT,
    consecutive_failures    INT DEFAULT 0,
    success_rate_30d        NUMERIC(5,2),
    avg_duration_seconds    NUMERIC(8,2),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications_queue (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id             TEXT REFERENCES users(id),
    notification_type   TEXT NOT NULL,
    subject             TEXT,
    body_html           TEXT,
    body_text           TEXT,
    related_ids         JSONB DEFAULT '[]',
    status              TEXT DEFAULT 'pending',
    priority            INT DEFAULT 5,
    scheduled_for       TIMESTAMPTZ DEFAULT NOW(),
    sent_at             TIMESTAMPTZ,
    error_message       TEXT,
    attempt             INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- INDEXES — Core tables
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_download_links_tenant ON download_links(tenant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_status ON pipeline_jobs(status, priority, triggered_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_stale ON pipeline_jobs(status, started_at) WHERE status = 'running';

-- =============================================================================
-- TRIGGERS — Core tables
-- =============================================================================

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_tenants_updated_at BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON tenant_profiles
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
