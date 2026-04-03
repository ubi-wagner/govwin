-- Visitor analytics: track unique visitors, page views, interactions, and journey to conversion
-- Links anonymous sessions to waitlist signups when they convert

-- Each unique visitor gets a session (cookie-based visitor_id)
CREATE TABLE IF NOT EXISTS visitor_sessions (
  id SERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL,                    -- client-generated UUID stored in cookie
  ip_address TEXT,
  user_agent TEXT,
  referer TEXT,                                -- initial referer (how they found us)
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  country TEXT,
  region TEXT,
  city TEXT,
  device_type TEXT,                            -- desktop, mobile, tablet
  browser TEXT,
  os TEXT,
  screen_width INT,
  screen_height INT,
  language TEXT,
  waitlist_id INT REFERENCES waitlist(id),     -- linked when they convert
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  page_view_count INT NOT NULL DEFAULT 0,
  interaction_count INT NOT NULL DEFAULT 0,
  UNIQUE(visitor_id)
);

-- Every page view
CREATE TABLE IF NOT EXISTS page_views (
  id SERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  path TEXT NOT NULL,                          -- e.g. /engine, /get-started
  page_title TEXT,
  referrer_path TEXT,                          -- previous page on site (internal navigation)
  time_on_page_ms INT,                         -- filled on next navigation or unload
  scroll_depth_pct INT,                        -- max scroll percentage reached
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Component-level interactions (CTA clicks, section views, form starts, etc.)
CREATE TABLE IF NOT EXISTS page_interactions (
  id SERIAL PRIMARY KEY,
  visitor_id TEXT NOT NULL,
  path TEXT NOT NULL,                          -- page where interaction happened
  event_type TEXT NOT NULL,                    -- 'click', 'view', 'scroll_to', 'form_start', 'form_submit'
  target TEXT NOT NULL,                        -- e.g. 'cta_join_waitlist', 'nav_pricing', 'section_hero'
  target_label TEXT,                           -- human-readable label of what was clicked
  metadata JSONB,                              -- extra data (scroll %, viewport, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor_id ON visitor_sessions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_first_seen ON visitor_sessions(first_seen_at);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_waitlist ON visitor_sessions(waitlist_id);
CREATE INDEX IF NOT EXISTS idx_page_views_visitor_id ON page_views(visitor_id);
CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(path);
CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_page_interactions_visitor_id ON page_interactions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_page_interactions_event_type ON page_interactions(event_type);
CREATE INDEX IF NOT EXISTS idx_page_interactions_target ON page_interactions(target);

-- Add visitor_id to waitlist table so we can link signups to sessions
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS visitor_id TEXT;
