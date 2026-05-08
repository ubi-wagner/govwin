-- 033: Enhance visitor_sessions and page_views for traffic analytics

ALTER TABLE page_views ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS referrer TEXT;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS page_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_session_id ON page_views(session_id);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_created_at ON visitor_sessions(created_at);
