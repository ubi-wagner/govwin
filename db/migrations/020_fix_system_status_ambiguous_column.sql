-- Migration 020: Fix ambiguous column in get_system_status()
--
-- Fixes: "column reference 'source' is ambiguous" error in the api_keys
-- subquery where api_key_status and api_key_registry both have a source column.

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

        'api_keys', (SELECT COALESCE(jsonb_object_agg(aks.source, jsonb_build_object(
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
