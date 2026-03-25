-- Migration 016: Event System Enhancements
-- Adds correlation_id for event chaining, enriches NOTIFY payloads,
-- and adds content.configured event type support.

BEGIN;

-- ─── Add correlation_id to all 3 event tables ─────────────────────
-- Links related events so automation can trace chains:
--   ingest.new → scoring.scored → finder.opp_presented
ALTER TABLE opportunity_events ADD COLUMN IF NOT EXISTS correlation_id UUID;
ALTER TABLE customer_events    ADD COLUMN IF NOT EXISTS correlation_id UUID;
ALTER TABLE content_events     ADD COLUMN IF NOT EXISTS correlation_id UUID;

CREATE INDEX IF NOT EXISTS idx_opp_events_corr  ON opportunity_events(correlation_id) WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cust_events_corr ON customer_events(correlation_id)    WHERE correlation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cont_events_corr ON content_events(correlation_id)     WHERE correlation_id IS NOT NULL;

-- ─── Enrich NOTIFY trigger payloads ───────────────────────────────
-- Include correlation_id + metadata so downstream workers get full
-- context without re-querying the event table.

CREATE OR REPLACE FUNCTION notify_opportunity_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('opportunity_events',
        json_build_object(
            'event_id',       NEW.id,
            'opportunity_id', NEW.opportunity_id,
            'event_type',     NEW.event_type,
            'source',         NEW.source,
            'correlation_id', NEW.correlation_id,
            'field_changed',  NEW.field_changed,
            'metadata',       NEW.metadata
        )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_customer_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('customer_events',
        json_build_object(
            'event_id',       NEW.id,
            'tenant_id',      NEW.tenant_id,
            'event_type',     NEW.event_type,
            'opportunity_id', NEW.opportunity_id,
            'user_id',        NEW.user_id,
            'correlation_id', NEW.correlation_id,
            'description',    NEW.description,
            'metadata',       NEW.metadata
        )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION notify_content_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('content_events',
        json_build_object(
            'id',             NEW.id,
            'page_key',       NEW.page_key,
            'event_type',     NEW.event_type,
            'source',         NEW.source,
            'user_id',        NEW.user_id,
            'correlation_id', NEW.correlation_id,
            'diff_summary',   NEW.diff_summary,
            'metadata',       NEW.metadata
        )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Update mark_events_processed to also handle content_events ───
CREATE OR REPLACE FUNCTION mark_events_processed(
    p_table TEXT,
    p_event_ids UUID[],
    p_worker TEXT
)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    IF p_table = 'opportunity_events' THEN
        UPDATE opportunity_events
        SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
        WHERE id = ANY(p_event_ids) AND processed = FALSE;
    ELSIF p_table = 'customer_events' THEN
        UPDATE customer_events
        SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
        WHERE id = ANY(p_event_ids) AND processed = FALSE;
    ELSE
        RAISE EXCEPTION 'Invalid event table: %', p_table;
    END IF;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;
