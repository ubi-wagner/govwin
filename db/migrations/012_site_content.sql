-- Migration 012: Content Management System
-- Stores dynamic front-facing page content with draft/published workflow
-- One row per page, hybrid JSON model (full page JSON, section-level editing in UI)

-- ─── Site Content Table ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_content (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_key        TEXT NOT NULL UNIQUE,          -- 'home','about','team','tips','customers','announcements','get_started'
    display_name    TEXT NOT NULL,                  -- Human-readable page name for CMS UI

    -- Draft state (working copy, always present)
    draft_content   JSONB NOT NULL DEFAULT '{}',    -- Full page content JSON
    draft_metadata  JSONB NOT NULL DEFAULT '{}',    -- SEO: { title, description, keywords }
    draft_updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    draft_updated_by    TEXT REFERENCES users(id),

    -- Published state (live on site, NULL if never published)
    published_content   JSONB,
    published_metadata  JSONB,
    published_at        TIMESTAMPTZ,
    published_by        TEXT REFERENCES users(id),

    -- Previous published (one level of rollback)
    previous_content    JSONB,
    previous_metadata   JSONB,
    previous_published_at TIMESTAMPTZ,

    -- Automation config
    auto_publish    BOOLEAN NOT NULL DEFAULT FALSE, -- If true, pipeline-generated content publishes immediately
    content_source  TEXT NOT NULL DEFAULT 'manual',  -- 'manual', 'generated', 'hybrid'

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_site_content_page ON site_content(page_key);
CREATE INDEX IF NOT EXISTS idx_site_content_auto ON site_content(auto_publish) WHERE auto_publish = TRUE;

-- ─── Content Change Log ──────────────────────────────────────────────
-- Immutable history of all content changes for audit trail
-- Uses same event pattern as opportunity_events and customer_events

CREATE TABLE IF NOT EXISTS content_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    page_key        TEXT NOT NULL,
    event_type      TEXT NOT NULL,
        -- content.draft_saved      — Editor saved a draft
        -- content.published        — Content was published to live
        -- content.rolled_back      — Rolled back to previous version
        -- content.auto_generated   — Pipeline generated new content
        -- content.auto_published   — Auto-publish pushed content live
        -- content.unpublished      — Content was taken offline
    user_id         TEXT,                           -- NULL for system/automation actions
    content_snapshot JSONB,                         -- Full content at time of event (for restore)
    metadata_snapshot JSONB,                        -- SEO metadata at time of event
    diff_summary    TEXT,                           -- Human-readable change description
    source          TEXT NOT NULL DEFAULT 'admin',  -- 'admin', 'pipeline', 'api'
    metadata        JSONB NOT NULL DEFAULT '{}',    -- Extra context
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_content_events_page ON content_events(page_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_events_type ON content_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_events_user ON content_events(user_id) WHERE user_id IS NOT NULL;

-- Notify trigger for content events (mirrors opportunity/customer event pattern)
CREATE OR REPLACE FUNCTION notify_content_event() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify('content_events', json_build_object(
        'id', NEW.id,
        'page_key', NEW.page_key,
        'event_type', NEW.event_type,
        'source', NEW.source,
        'created_at', NEW.created_at
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_content_event ON content_events;
CREATE TRIGGER trg_content_event
    AFTER INSERT ON content_events
    FOR EACH ROW EXECUTE FUNCTION notify_content_event();

-- ─── Seed initial page records ──────────────────────────────────────
-- Each front-facing page gets a row. Draft content starts empty; the app
-- falls back to static content when published_content IS NULL.

INSERT INTO site_content (page_key, display_name) VALUES
    ('home',          'Home Page'),
    ('about',         'About'),
    ('team',          'Team'),
    ('tips',          'Tips & Tools'),
    ('customers',     'Customer Wins'),
    ('announcements', 'Announcements'),
    ('get_started',   'Get Started / Pricing')
ON CONFLICT (page_key) DO NOTHING;
