-- Migration 018: Status reporting enhancements
--
-- Problems addressed:
--   1. get_system_status() returns only source status strings, not actual health metrics
--   2. No way to track whether a completed job actually produced results vs just ran
--   3. API keys marked "valid" based on expiry only — no actual connectivity check
--   4. Dashboard shows failed_24h but hides chronic failures
--   5. source_health table exists with rich data but API never returns it
--
-- Changes:
--   - Enriched get_system_status() with actual source_health metrics
--   - Added last_validated_at + last_validation_result to api_key_registry
--   - Added execution_notes to pipeline_jobs for honest result commentary
--   - Added failed_total and stale_running counts to pipeline status

-- ─── 1. Track API key validation results ──────────────────────

ALTER TABLE api_key_registry
  ADD COLUMN IF NOT EXISTS last_validated_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_validation_ok  BOOLEAN,
  ADD COLUMN IF NOT EXISTS last_validation_msg TEXT;

COMMENT ON COLUMN api_key_registry.last_validated_at IS
  'When was this key last tested against the external service?';
COMMENT ON COLUMN api_key_registry.last_validation_ok IS
  'Did the last validation test succeed? NULL = never tested.';
COMMENT ON COLUMN api_key_registry.last_validation_msg IS
  'Human-readable result of the last validation test.';

-- ─── 2. Track execution quality on pipeline jobs ──────────────

ALTER TABLE pipeline_jobs
  ADD COLUMN IF NOT EXISTS execution_notes TEXT;

COMMENT ON COLUMN pipeline_jobs.execution_notes IS
  'Post-execution commentary: warnings, partial results, credential issues. '
  'A completed job is not necessarily a successful one.';

-- ─── 3. Enriched get_system_status() ──────────────────────────
--
-- Old: returned source_health as {source: status_string}
-- New: returns source_health as {source: {status, consecutive_failures,
--        last_success_at, last_error_at, last_error_message, avg_duration_seconds}}
--
-- Old: returned api_keys as {source: expiry_status_string}
-- New: returns api_keys as {source: {expiry_status, has_stored_key,
--        last_validated_at, last_validation_ok, last_validation_msg, key_hint}}
--
-- Old: pipeline_jobs had pending/running/failed_24h
-- New: also includes failed_total, stale_running (running > 1 hour), completed_24h

CREATE OR REPLACE FUNCTION get_system_status()
RETURNS JSONB AS $$
BEGIN
    RETURN jsonb_build_object(
        'pipeline_jobs', (SELECT jsonb_build_object(
            'pending',       COUNT(*) FILTER (WHERE status = 'pending'),
            'running',       COUNT(*) FILTER (WHERE status = 'running'),
            'failed_24h',    COUNT(*) FILTER (WHERE status = 'failed'
                             AND triggered_at > NOW() - INTERVAL '24 hours'),
            'failed_total',  COUNT(*) FILTER (WHERE status = 'failed'),
            'completed_24h', COUNT(*) FILTER (WHERE status = 'completed'
                             AND completed_at > NOW() - INTERVAL '24 hours'),
            'stale_running', COUNT(*) FILTER (WHERE status = 'running'
                             AND started_at < NOW() - INTERVAL '1 hour')
        ) FROM pipeline_jobs),

        'tenants', (SELECT jsonb_build_object(
            'total',   COUNT(*),
            'active',  COUNT(*) FILTER (WHERE status = 'active'),
            'trial',   COUNT(*) FILTER (WHERE status = 'trial')
        ) FROM tenants),

        'source_health', (SELECT COALESCE(jsonb_object_agg(source, jsonb_build_object(
            'status',                status,
            'consecutive_failures',  consecutive_failures,
            'last_success_at',       last_success_at,
            'last_error_at',         last_error_at,
            'last_error_message',    last_error_message,
            'avg_duration_seconds',  avg_duration_seconds,
            'success_rate_30d',      success_rate_30d
        )), '{}'::jsonb) FROM source_health),

        'api_keys', (SELECT COALESCE(jsonb_object_agg(source, jsonb_build_object(
            'expiry_status',       aks.expiry_status,
            'has_stored_key',      akr.encrypted_value IS NOT NULL,
            'key_hint',            akr.key_hint,
            'expires_date',        akr.expires_date,
            'days_until_expiry',   CASE WHEN akr.expires_date IS NOT NULL
                                     THEN (akr.expires_date - CURRENT_DATE)
                                     ELSE NULL END,
            'last_validated_at',   akr.last_validated_at,
            'last_validation_ok',  akr.last_validation_ok,
            'last_validation_msg', akr.last_validation_msg,
            'rotated_at',          akr.rotated_at
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

-- ─── 4. Useful index for stale job detection ──────────────────

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_stale
  ON pipeline_jobs (status, started_at)
  WHERE status = 'running';
