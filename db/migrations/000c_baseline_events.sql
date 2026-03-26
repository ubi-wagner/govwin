-- =============================================================================
-- 000c — Event System, CMS, Automation, Consent/Legal
-- Part 3 of 4 baseline migrations (consolidated from 001-022)
-- =============================================================================

-- =============================================================================
-- EVENT BUS — Three append-only event tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS opportunity_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id      UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    event_type          TEXT NOT NULL,
    source              TEXT NOT NULL,
    field_changed       TEXT,
    old_value           TEXT,
    new_value           TEXT,
    snapshot_hash       TEXT,
    metadata            JSONB DEFAULT '{}',
    processed           BOOLEAN DEFAULT FALSE,
    processed_by        TEXT,
    processed_at        TIMESTAMPTZ,
    correlation_id      UUID,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id             TEXT REFERENCES users(id),
    event_type          TEXT NOT NULL,
    opportunity_id      UUID REFERENCES opportunities(id),
    entity_type         TEXT,
    entity_id           TEXT,
    description         TEXT,
    metadata            JSONB DEFAULT '{}',
    processed           BOOLEAN DEFAULT FALSE,
    processed_by        TEXT,
    processed_at        TIMESTAMPTZ,
    correlation_id      UUID,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CMS — Site Content & Content Events
-- =============================================================================

CREATE TABLE IF NOT EXISTS site_content (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_key                TEXT NOT NULL UNIQUE,
    display_name            TEXT NOT NULL,
    draft_content           JSONB NOT NULL DEFAULT '{}',
    draft_metadata          JSONB NOT NULL DEFAULT '{}',
    draft_updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    draft_updated_by        TEXT REFERENCES users(id),
    published_content       JSONB,
    published_metadata      JSONB,
    published_at            TIMESTAMPTZ,
    published_by            TEXT REFERENCES users(id),
    previous_content        JSONB,
    previous_metadata       JSONB,
    previous_published_at   TIMESTAMPTZ,
    auto_publish            BOOLEAN NOT NULL DEFAULT FALSE,
    content_source          TEXT NOT NULL DEFAULT 'manual',
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS content_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_key            TEXT NOT NULL,
    event_type          TEXT NOT NULL,
    user_id             TEXT,
    content_snapshot    JSONB,
    metadata_snapshot   JSONB,
    diff_summary        TEXT,
    source              TEXT NOT NULL DEFAULT 'admin',
    metadata            JSONB NOT NULL DEFAULT '{}',
    correlation_id      UUID,
    processed           BOOLEAN NOT NULL DEFAULT FALSE,
    processed_by        TEXT,
    processed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- AUTOMATION FRAMEWORK
-- =============================================================================

CREATE TABLE IF NOT EXISTS automation_rules (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                TEXT NOT NULL UNIQUE,
    description         TEXT,
    trigger_bus         TEXT NOT NULL,
    trigger_events      TEXT[] NOT NULL,
    conditions          JSONB DEFAULT '{}',
    action_type         TEXT NOT NULL,
    action_config       JSONB NOT NULL DEFAULT '{}',
    enabled             BOOLEAN DEFAULT TRUE,
    priority            INT DEFAULT 50,
    cooldown_seconds    INT DEFAULT 0,
    max_fires_per_hour  INT DEFAULT 0,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_log (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_id             UUID REFERENCES automation_rules(id) ON DELETE SET NULL,
    rule_name           TEXT NOT NULL,
    trigger_event_id    UUID,
    trigger_event_type  TEXT,
    trigger_bus         TEXT,
    fired               BOOLEAN NOT NULL DEFAULT FALSE,
    skip_reason         TEXT,
    action_type         TEXT,
    action_result       JSONB,
    event_metadata      JSONB,
    correlation_id      UUID,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- CONSENT & LEGAL
-- =============================================================================

CREATE TABLE IF NOT EXISTS consent_records (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id           UUID REFERENCES tenants(id) ON DELETE SET NULL,
    document_type       TEXT NOT NULL,
    document_version    TEXT NOT NULL,
    action              TEXT NOT NULL DEFAULT 'accept',
    summary             TEXT,
    entity_type         TEXT,
    entity_id           TEXT,
    ip_address          TEXT,
    user_agent          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS legal_document_versions (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_type       TEXT NOT NULL,
    version             TEXT NOT NULL,
    effective_date      DATE NOT NULL,
    summary_of_changes  TEXT,
    is_current          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (document_type, version)
);

-- =============================================================================
-- INDEXES — Events, CMS, Automation, Consent
-- =============================================================================

-- Opportunity events
CREATE INDEX IF NOT EXISTS idx_opp_events_opp ON opportunity_events(opportunity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opp_events_type ON opportunity_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opp_events_unprocessed ON opportunity_events(processed, event_type) WHERE processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_opp_events_source ON opportunity_events(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_opp_events_corr ON opportunity_events(correlation_id) WHERE correlation_id IS NOT NULL;

-- Customer events
CREATE INDEX IF NOT EXISTS idx_cust_events_tenant ON customer_events(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cust_events_type ON customer_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cust_events_unprocessed ON customer_events(processed, event_type) WHERE processed = FALSE;
CREATE INDEX IF NOT EXISTS idx_cust_events_opp ON customer_events(opportunity_id) WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cust_events_user ON customer_events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cust_events_corr ON customer_events(correlation_id) WHERE correlation_id IS NOT NULL;

-- Content events
CREATE INDEX IF NOT EXISTS idx_content_events_page ON content_events(page_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_events_type ON content_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_events_user ON content_events(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_events_corr ON content_events(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_content_events_unprocessed ON content_events(created_at) WHERE processed = FALSE;

-- CMS
CREATE INDEX IF NOT EXISTS idx_site_content_page ON site_content(page_key);
CREATE INDEX IF NOT EXISTS idx_site_content_auto ON site_content(auto_publish) WHERE auto_publish = TRUE;

-- Automation
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger ON automation_rules(trigger_bus, enabled) WHERE enabled = TRUE;
CREATE INDEX IF NOT EXISTS idx_automation_log_rule ON automation_log(rule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_automation_log_event ON automation_log(trigger_event_id);
CREATE INDEX IF NOT EXISTS idx_automation_log_created ON automation_log(created_at DESC);

-- Consent
CREATE INDEX IF NOT EXISTS idx_consent_user_doctype ON consent_records(user_id, document_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_tenant ON consent_records(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_entity ON consent_records(entity_type, entity_id, created_at DESC) WHERE entity_type IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_legal_doc_current ON legal_document_versions(document_type) WHERE is_current = TRUE;
