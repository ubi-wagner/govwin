-- =============================================================================
-- Migration 002 — Control Plane
-- Scheduler, job queue, config, rate limits, feature flags
-- All system behavior controlled via Postgres — no config file redeployment
-- =============================================================================

-- =============================================================================
-- SYSTEM CONFIG
-- Global key/value. Admin UI writes; pipeline reads.
-- =============================================================================

CREATE TABLE system_config (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_by  TEXT DEFAULT 'system'
);

INSERT INTO system_config (key, value, description) VALUES
    ('scoring.llm_trigger_score',      '50',   'Run Claude analysis above this score'),
    ('scoring.llm_max_adjustment',     '20',   'Max score adjustment by LLM (+/-)'),
    ('pipeline.retry_attempts',        '3',    'Retry count before marking failed'),
    ('pipeline.retry_delay_seconds',   '30',   'Delay between retries'),
    ('pipeline.max_concurrent_jobs',   '2',    'Max simultaneous jobs'),
    ('notifications.digest_hour',      '7',    'Hour (UTC) to send daily digest'),
    ('features.llm_analysis',          'true', 'Enable Claude LLM analysis globally'),
    ('features.document_download',     'true', 'Enable auto document download'),
    ('features.embeddings',            'true', 'Enable vector embeddings'),
    ('features.tenant_self_service',   'false','Tenants can edit their own profiles'),
    ('features.tenant_uploads',        'true', 'Tenants can upload documents'),
    ('features.portal_comments',       'true', 'Tenants can comment on opportunities');

-- =============================================================================
-- API KEY REGISTRY
-- =============================================================================

CREATE TABLE api_key_registry (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source          TEXT NOT NULL UNIQUE,
    env_var         TEXT NOT NULL,
    key_hint        TEXT,
    issued_date     DATE,
    expires_date    DATE,
    days_warning    INT DEFAULT 15,
    last_validated  TIMESTAMPTZ,
    is_valid        BOOLEAN DEFAULT TRUE,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO api_key_registry (source, env_var, days_warning, notes) VALUES
    ('sam_gov',   'SAM_GOV_API_KEY',   15, 'Expires every 90 days. Rotate at sam.gov'),
    ('anthropic', 'ANTHROPIC_API_KEY', 30, 'No expiry. Rotate periodically.');

CREATE VIEW api_key_status AS
SELECT
    source, key_hint, env_var, expires_date, is_valid,
    CASE WHEN expires_date IS NULL THEN NULL
         ELSE (expires_date - CURRENT_DATE)::INT END AS days_until_expiry,
    CASE WHEN expires_date IS NULL THEN 'no_expiry'
         WHEN (expires_date - CURRENT_DATE) < 0 THEN 'expired'
         WHEN (expires_date - CURRENT_DATE) < days_warning THEN 'expiring_soon'
         ELSE 'ok' END AS expiry_status,
    notes
FROM api_key_registry;

-- =============================================================================
-- PIPELINE SCHEDULES
-- =============================================================================

CREATE TABLE pipeline_schedules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source          TEXT NOT NULL UNIQUE,
    display_name    TEXT NOT NULL,
    run_type        TEXT NOT NULL DEFAULT 'full',
    cron_expression TEXT NOT NULL,
    timezone        TEXT NOT NULL DEFAULT 'UTC',
    enabled         BOOLEAN DEFAULT TRUE,
    priority        INT DEFAULT 5,
    timeout_minutes INT DEFAULT 30,
    last_run_at     TIMESTAMPTZ,
    next_run_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO pipeline_schedules (source, display_name, run_type, cron_expression, priority) VALUES
    ('sam_gov',     'SAM.gov Daily',        'full',    '0 6 * * *',   1),
    ('grants_gov',  'Grants.gov Daily',     'full',    '0 6 * * *',   2),
    ('sbir',        'SBIR Weekly',          'full',    '0 7 * * 1',   3),
    ('usaspending', 'USASpending Intel',    'intel',   '0 8 * * 0',   4),
    ('refresh',     'Open Opp Refresh',     'refresh', '0 */4 * * *', 2),
    ('scoring',     'Re-score All Tenants', 'score',   '0 5 * * *',   3),
    ('digest',      'Email Digests',        'notify',  '0 7 * * *',   5);

-- =============================================================================
-- RATE LIMIT STATE
-- =============================================================================

CREATE TABLE rate_limit_state (
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

INSERT INTO rate_limit_state (source, daily_limit, hourly_limit) VALUES
    ('sam_gov',     1000, NULL),
    ('sbir',        NULL, 30),
    ('grants_gov',  NULL, NULL),
    ('usaspending', NULL, NULL),
    ('anthropic',   NULL, NULL);

CREATE OR REPLACE FUNCTION get_remaining_quota(p_source TEXT)
RETURNS TABLE(daily_remaining INT, hourly_remaining INT, can_proceed BOOLEAN) AS $$
DECLARE r rate_limit_state%ROWTYPE;
BEGIN
    SELECT * INTO r FROM rate_limit_state WHERE source = p_source;
    IF r.window_date < CURRENT_DATE THEN
        UPDATE rate_limit_state SET requests_today = 0, window_date = CURRENT_DATE WHERE source = p_source;
        r.requests_today := 0;
    END IF;
    IF r.window_hour != EXTRACT(HOUR FROM NOW())::INT THEN
        UPDATE rate_limit_state SET requests_this_hour = 0,
            window_hour = EXTRACT(HOUR FROM NOW())::INT WHERE source = p_source;
        r.requests_this_hour := 0;
    END IF;
    RETURN QUERY SELECT
        CASE WHEN r.daily_limit IS NULL THEN NULL::INT ELSE r.daily_limit - r.requests_today END,
        CASE WHEN r.hourly_limit IS NULL THEN NULL::INT ELSE r.hourly_limit - r.requests_this_hour END,
        (r.daily_limit IS NULL OR r.requests_today < r.daily_limit) AND
        (r.hourly_limit IS NULL OR r.requests_this_hour < r.hourly_limit);
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- PIPELINE JOBS — The Queue
-- Admin or scheduler inserts here → NOTIFY wakes Python worker immediately
-- =============================================================================

CREATE TABLE pipeline_jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source          TEXT NOT NULL,
    run_type        TEXT NOT NULL DEFAULT 'full',
    status          TEXT NOT NULL DEFAULT 'pending',
    triggered_by    TEXT NOT NULL DEFAULT 'scheduler',
    triggered_at    TIMESTAMPTZ DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    worker_id       TEXT,
    priority        INT DEFAULT 5,
    attempt         INT DEFAULT 1,
    max_attempts    INT DEFAULT 3,
    parameters      JSONB DEFAULT '{}',
    result          JSONB,
    error_message   TEXT
);

CREATE INDEX idx_pipeline_jobs_status ON pipeline_jobs(status, priority, triggered_at);

-- NOTIFY trigger: wakes Python worker on insert
CREATE OR REPLACE FUNCTION notify_pipeline_worker()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'pending' THEN
        PERFORM pg_notify('pipeline_worker',
            json_build_object(
                'job_id', NEW.id, 'source', NEW.source,
                'run_type', NEW.run_type, 'priority', NEW.priority
            )::text);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_pipeline_worker
    AFTER INSERT ON pipeline_jobs
    FOR EACH ROW EXECUTE FUNCTION notify_pipeline_worker();

-- Safe atomic dequeue — FOR UPDATE SKIP LOCKED prevents double-pickup
CREATE OR REPLACE FUNCTION dequeue_job(p_worker_id TEXT)
RETURNS pipeline_jobs AS $$
DECLARE v_job pipeline_jobs;
BEGIN
    SELECT * INTO v_job FROM pipeline_jobs
    WHERE status = 'pending'
    ORDER BY priority ASC, triggered_at ASC
    LIMIT 1 FOR UPDATE SKIP LOCKED;

    IF FOUND THEN
        UPDATE pipeline_jobs
        SET status = 'running', started_at = NOW(), worker_id = p_worker_id
        WHERE id = v_job.id RETURNING * INTO v_job;
    END IF;
    RETURN v_job;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- PIPELINE RUNS — Audit Log
-- =============================================================================

CREATE TABLE pipeline_runs (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id                UUID REFERENCES pipeline_jobs(id),
    source                TEXT NOT NULL,
    run_type              TEXT NOT NULL,
    started_at            TIMESTAMPTZ NOT NULL,
    completed_at          TIMESTAMPTZ,
    duration_seconds      NUMERIC GENERATED ALWAYS AS (
                              EXTRACT(EPOCH FROM (completed_at - started_at))
                          ) STORED,
    status                TEXT NOT NULL,
    opportunities_fetched INT DEFAULT 0,
    opportunities_new     INT DEFAULT 0,
    opportunities_updated INT DEFAULT 0,
    tenants_scored        INT DEFAULT 0,
    documents_downloaded  INT DEFAULT 0,
    llm_calls_made        INT DEFAULT 0,
    llm_tokens_used       INT DEFAULT 0,
    llm_cost_usd          NUMERIC(10,4),
    amendments_detected   INT DEFAULT 0,
    errors                JSONB DEFAULT '[]',
    metadata              JSONB DEFAULT '{}'
);

-- =============================================================================
-- SOURCE HEALTH
-- =============================================================================

CREATE TABLE source_health (
    source                TEXT PRIMARY KEY,
    status                TEXT DEFAULT 'unknown',
    last_success_at       TIMESTAMPTZ,
    last_error_at         TIMESTAMPTZ,
    last_error_message    TEXT,
    consecutive_failures  INT DEFAULT 0,
    success_rate_30d      NUMERIC(5,2),
    avg_duration_seconds  NUMERIC(8,2),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO source_health (source) VALUES
    ('sam_gov'), ('sbir'), ('grants_gov'), ('usaspending');

-- =============================================================================
-- NOTIFICATIONS QUEUE
-- =============================================================================

CREATE TABLE notifications_queue (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id           TEXT REFERENCES users(id),
    notification_type TEXT NOT NULL,
    subject           TEXT,
    body_html         TEXT,
    body_text         TEXT,
    related_ids       JSONB DEFAULT '[]',
    status            TEXT DEFAULT 'pending',
    priority          INT DEFAULT 5,
    scheduled_for     TIMESTAMPTZ DEFAULT NOW(),
    sent_at           TIMESTAMPTZ,
    error_message     TEXT,
    attempt           INT DEFAULT 0,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- SYSTEM STATUS FUNCTION
-- Single call returns everything the admin dashboard needs
-- =============================================================================

CREATE OR REPLACE FUNCTION get_system_status()
RETURNS JSONB AS $$
BEGIN
    RETURN jsonb_build_object(
        'pipeline_jobs', (SELECT jsonb_build_object(
            'pending',    COUNT(*) FILTER (WHERE status = 'pending'),
            'running',    COUNT(*) FILTER (WHERE status = 'running'),
            'failed_24h', COUNT(*) FILTER (WHERE status = 'failed'
                          AND triggered_at > NOW() - INTERVAL '24 hours')
        ) FROM pipeline_jobs),
        'tenants', (SELECT jsonb_build_object(
            'total',   COUNT(*),
            'active',  COUNT(*) FILTER (WHERE status = 'active'),
            'trial',   COUNT(*) FILTER (WHERE status = 'trial')
        ) FROM tenants),
        'source_health',   (SELECT jsonb_object_agg(source, status) FROM source_health),
        'api_keys',        (SELECT jsonb_object_agg(source, expiry_status) FROM api_key_status),
        'rate_limits',     (SELECT jsonb_object_agg(source,
            jsonb_build_object('used', requests_today, 'limit', daily_limit)
        ) FROM rate_limit_state),
        'checked_at', NOW()
    );
END;
$$ LANGUAGE plpgsql;
