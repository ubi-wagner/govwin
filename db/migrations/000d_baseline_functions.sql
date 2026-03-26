-- =============================================================================
-- 000d — All Database Functions (FINAL versions)
-- Part 4 of 5 baseline migrations
-- =============================================================================

-- ─── Rate Limiting ──────────────────────────────────────────────
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

-- ─── Pipeline Job Queue ─────────────────────────────────────────
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

-- ─── System Status (from migration 020 — uses aks.source) ──────
CREATE OR REPLACE FUNCTION get_system_status()
RETURNS JSONB AS $$
BEGIN
    RETURN jsonb_build_object(
        'pipeline_jobs', (SELECT jsonb_build_object(
            'pending',       COUNT(*) FILTER (WHERE status = 'pending'),
            'running',       COUNT(*) FILTER (WHERE status = 'running'),
            'failed_24h',    COUNT(*) FILTER (WHERE status = 'failed' AND triggered_at > NOW() - INTERVAL '24 hours'),
            'failed_total',  COUNT(*) FILTER (WHERE status = 'failed'),
            'completed_24h', COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '24 hours'),
            'stale_running', COUNT(*) FILTER (WHERE status = 'running' AND started_at < NOW() - INTERVAL '1 hour')
        ) FROM pipeline_jobs),
        'tenants', (SELECT jsonb_build_object(
            'total',  COUNT(*),
            'active', COUNT(*) FILTER (WHERE status = 'active'),
            'trial',  COUNT(*) FILTER (WHERE status = 'trial')
        ) FROM tenants),
        'source_health', (SELECT COALESCE(jsonb_object_agg(source, jsonb_build_object(
            'status', status, 'consecutive_failures', consecutive_failures,
            'last_success_at', last_success_at, 'last_error_at', last_error_at,
            'last_error_message', last_error_message, 'avg_duration_seconds', avg_duration_seconds,
            'success_rate_30d', success_rate_30d
        )), '{}'::jsonb) FROM source_health),
        'api_keys', (SELECT COALESCE(jsonb_object_agg(aks.source, jsonb_build_object(
            'expiry_status', aks.expiry_status,
            'has_stored_key', akr.encrypted_value IS NOT NULL,
            'key_hint', akr.key_hint, 'expires_date', akr.expires_date,
            'days_until_expiry', CASE WHEN akr.expires_date IS NOT NULL THEN (akr.expires_date - CURRENT_DATE) ELSE NULL END,
            'last_validated_at', akr.last_validated_at,
            'last_validation_ok', akr.last_validation_ok,
            'last_validation_msg', akr.last_validation_msg,
            'rotated_at', akr.rotated_at
        )), '{}'::jsonb)
        FROM api_key_status aks
        JOIN api_key_registry akr ON akr.source = aks.source),
        'rate_limits', (SELECT COALESCE(jsonb_object_agg(source,
            jsonb_build_object('used', requests_today, 'limit', daily_limit)
        ), '{}'::jsonb) FROM rate_limit_state),
        'checked_at', NOW()
    );
END;
$$ LANGUAGE plpgsql;

-- ─── Event NOTIFY Triggers (from migration 016) ────────────────
CREATE OR REPLACE FUNCTION notify_opportunity_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('opportunity_events', json_build_object(
        'event_id', NEW.id, 'opportunity_id', NEW.opportunity_id,
        'event_type', NEW.event_type, 'source', NEW.source,
        'correlation_id', NEW.correlation_id, 'field_changed', NEW.field_changed,
        'metadata', NEW.metadata
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_opportunity_event
    AFTER INSERT ON opportunity_events
    FOR EACH ROW EXECUTE FUNCTION notify_opportunity_event();

CREATE OR REPLACE FUNCTION notify_customer_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('customer_events', json_build_object(
        'event_id', NEW.id, 'tenant_id', NEW.tenant_id,
        'event_type', NEW.event_type, 'opportunity_id', NEW.opportunity_id,
        'user_id', NEW.user_id, 'correlation_id', NEW.correlation_id,
        'description', NEW.description, 'metadata', NEW.metadata
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_customer_event
    AFTER INSERT ON customer_events
    FOR EACH ROW EXECUTE FUNCTION notify_customer_event();

CREATE OR REPLACE FUNCTION notify_content_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('content_events', json_build_object(
        'id', NEW.id, 'page_key', NEW.page_key,
        'event_type', NEW.event_type, 'source', NEW.source,
        'user_id', NEW.user_id, 'correlation_id', NEW.correlation_id,
        'diff_summary', NEW.diff_summary, 'metadata', NEW.metadata
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_content_event
    AFTER INSERT ON content_events
    FOR EACH ROW EXECUTE FUNCTION notify_content_event();

-- ─── Event Processing (from migration 021) ──────────────────────
CREATE OR REPLACE FUNCTION mark_events_processed(
    p_table TEXT, p_event_ids UUID[], p_worker TEXT
) RETURNS INTEGER AS $$
DECLARE v_count INTEGER;
BEGIN
    IF p_table = 'opportunity_events' THEN
        UPDATE opportunity_events SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
        WHERE id = ANY(p_event_ids) AND processed = FALSE;
    ELSIF p_table = 'customer_events' THEN
        UPDATE customer_events SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
        WHERE id = ANY(p_event_ids) AND processed = FALSE;
    ELSIF p_table = 'content_events' THEN
        UPDATE content_events SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
        WHERE id = ANY(p_event_ids) AND processed = FALSE;
    ELSE
        RAISE EXCEPTION 'Invalid event table: %', p_table;
    END IF;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dequeue_opportunity_events(
    p_event_types TEXT[], p_worker TEXT, p_limit INTEGER DEFAULT 100
) RETURNS SETOF opportunity_events AS $$
BEGIN
    RETURN QUERY
    UPDATE opportunity_events
    SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
    WHERE id IN (
        SELECT id FROM opportunity_events
        WHERE processed = FALSE AND event_type = ANY(p_event_types)
        ORDER BY created_at ASC LIMIT p_limit FOR UPDATE SKIP LOCKED
    ) RETURNING *;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dequeue_customer_events(
    p_event_types TEXT[], p_worker TEXT, p_limit INTEGER DEFAULT 100
) RETURNS SETOF customer_events AS $$
BEGIN
    RETURN QUERY
    UPDATE customer_events
    SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
    WHERE id IN (
        SELECT id FROM customer_events
        WHERE processed = FALSE AND event_type = ANY(p_event_types)
        ORDER BY created_at ASC LIMIT p_limit FOR UPDATE SKIP LOCKED
    ) RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- ─── Utility Functions ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_iso_week_label(ts TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT AS $$
BEGIN
    RETURN TO_CHAR(ts, 'IYYY') || '-W' || LPAD(TO_CHAR(ts, 'IW'), 2, '0');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION check_opp_cap(p_tenant_id UUID)
RETURNS TABLE(can_attach BOOLEAN, active_count BIGINT, max_allowed INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) < t.max_active_opps,
        COUNT(*),
        t.max_active_opps
    FROM tenants t
    LEFT JOIN tenant_opportunities to2
        ON to2.tenant_id = t.id
        AND to2.pursuit_status IN ('pursuing', 'monitoring')
    WHERE t.id = p_tenant_id
    GROUP BY t.max_active_opps;
END;
$$ LANGUAGE plpgsql;
