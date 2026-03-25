-- Migration 021: Fix content_events processing support
--
-- Migration 016 added mark_events_processed() support for content_events
-- in the comment but never:
--   1. Added processed/processed_by/processed_at columns to content_events
--   2. Added the content_events CASE branch to the function
--
-- This migration fixes both.

-- ─── 1. Add processing columns to content_events ────────────────

ALTER TABLE content_events
  ADD COLUMN IF NOT EXISTS processed    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS processed_by TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_content_events_unprocessed
  ON content_events (created_at)
  WHERE processed = FALSE;

-- ─── 2. Fix mark_events_processed() to handle content_events ────

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
    ELSIF p_table = 'content_events' THEN
        UPDATE content_events
        SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
        WHERE id = ANY(p_event_ids) AND processed = FALSE;
    ELSE
        RAISE EXCEPTION 'Invalid event table: %', p_table;
    END IF;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;
