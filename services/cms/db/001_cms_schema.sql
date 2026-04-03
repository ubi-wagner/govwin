-- =============================================================================
-- CMS Database Schema — Separate database for content management
--
-- This runs against the CMS-specific PostgreSQL instance, NOT the main app DB.
-- Fully isolated from customer/tenant data.
--
-- Tables:
--   cms_posts          — Blog posts, articles, tips, announcements
--   cms_generations    — AI content generation requests and outputs
--   cms_reviews        — Immutable review decision audit log
--   cms_media          — Media file metadata (actual files on Railway volume)
--   cms_categories     — Content categories/tags taxonomy
--   cms_config         — Service configuration key-value store
--   cms_events         — Local event log (bridged to shared DB for automation)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- CMS_POSTS — The canonical article/post entity
-- =============================================================================
CREATE TABLE IF NOT EXISTS cms_posts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    slug                TEXT NOT NULL UNIQUE,
    title               TEXT NOT NULL,
    excerpt             TEXT,
    body                TEXT NOT NULL DEFAULT '',
    body_format         TEXT NOT NULL DEFAULT 'markdown'
        CHECK (body_format IN ('markdown', 'html', 'plaintext')),
    category            TEXT NOT NULL DEFAULT 'tip',
    tags                TEXT[] NOT NULL DEFAULT '{}',

    -- Workflow state
    status              TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','in_review','approved','rejected','published','reverted','archived')),

    -- Authorship
    author_id           TEXT,       -- references users in main DB (by ID)
    author_name         TEXT,
    author_email        TEXT,

    -- Media
    featured_image_id   UUID,       -- FK added after cms_media created
    featured_image_url  TEXT,       -- resolved URL/path for quick access

    -- Generation provenance (NULL if manually written)
    generation_id       UUID,       -- FK added after cms_generations created
    generated_by_model  TEXT,
    generation_prompt   TEXT,

    -- Review
    reviewed_by         TEXT,
    reviewed_at         TIMESTAMPTZ,
    review_notes        TEXT,

    -- Publishing
    published_at        TIMESTAMPTZ,
    published_by        TEXT,
    unpublished_at      TIMESTAMPTZ,

    -- SEO
    meta_title          TEXT,
    meta_description    TEXT,
    canonical_url       TEXT,
    og_image_url        TEXT,

    -- Version tracking
    version             INT NOT NULL DEFAULT 1,
    previous_body       TEXT,
    previous_title      TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- CMS_MEDIA — Media file metadata (files stored on Railway volume)
-- =============================================================================
CREATE TABLE IF NOT EXISTS cms_media (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    filename            TEXT NOT NULL,          -- original filename
    storage_path        TEXT NOT NULL UNIQUE,    -- relative path on volume
    content_type        TEXT NOT NULL,           -- MIME type
    size_bytes          BIGINT NOT NULL DEFAULT 0,
    width               INT,                    -- image width (NULL for non-images)
    height              INT,                    -- image height
    alt_text            TEXT,                   -- accessibility alt text
    caption             TEXT,

    -- Associations
    post_id             UUID REFERENCES cms_posts(id) ON DELETE SET NULL,
    usage               TEXT NOT NULL DEFAULT 'attachment'
        CHECK (usage IN ('featured_image', 'inline', 'attachment', 'og_image')),

    -- Tracking
    uploaded_by         TEXT,
    uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK from posts to media for featured image
ALTER TABLE cms_posts
    ADD CONSTRAINT fk_cms_posts_featured_image
    FOREIGN KEY (featured_image_id) REFERENCES cms_media(id)
    ON DELETE SET NULL;

-- =============================================================================
-- CMS_GENERATIONS — AI content generation requests and outputs
-- =============================================================================
CREATE TABLE IF NOT EXISTS cms_generations (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Request
    prompt              TEXT NOT NULL,
    category            TEXT NOT NULL DEFAULT 'tip',
    model               TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    system_prompt       TEXT,
    temperature         NUMERIC(3,2) NOT NULL DEFAULT 0.7,

    -- Output
    status              TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','generating','completed','failed','accepted','rejected')),
    generated_title     TEXT,
    generated_excerpt   TEXT,
    generated_body      TEXT,
    generated_tags      TEXT[] NOT NULL DEFAULT '{}',
    generated_meta      JSONB NOT NULL DEFAULT '{}',

    -- Linkage
    post_id             UUID REFERENCES cms_posts(id) ON DELETE SET NULL,

    -- Tracking
    requested_by        TEXT,
    tokens_used         INT,
    duration_ms         INT,
    error_message       TEXT,
    retry_count         INT NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);

-- Add FK from posts to generations
ALTER TABLE cms_posts
    ADD CONSTRAINT fk_cms_posts_generation
    FOREIGN KEY (generation_id) REFERENCES cms_generations(id)
    ON DELETE SET NULL;

-- =============================================================================
-- CMS_REVIEWS — Immutable review decision log
-- =============================================================================
CREATE TABLE IF NOT EXISTS cms_reviews (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id             UUID NOT NULL REFERENCES cms_posts(id) ON DELETE CASCADE,

    action              TEXT NOT NULL
        CHECK (action IN ('submit_review','approve','reject','request_changes','publish','unpublish','revert','archive')),
    reviewer_id         TEXT NOT NULL,
    reviewer_email      TEXT,
    notes               TEXT,

    -- Snapshot at time of review
    title_snapshot      TEXT,
    body_snapshot       TEXT,
    version_at_review   INT NOT NULL DEFAULT 1,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- CMS_EVENTS — Local event log (bridged to shared DB for automation)
-- =============================================================================
CREATE TABLE IF NOT EXISTS cms_events (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type          TEXT NOT NULL,           -- e.g. 'content_pipeline.post.published'
    entity_type         TEXT NOT NULL DEFAULT 'post',
    entity_id           UUID,
    user_id             TEXT,
    source              TEXT NOT NULL DEFAULT 'cms_service',
    diff_summary        TEXT,
    payload             JSONB NOT NULL DEFAULT '{}',
    bridged             BOOLEAN NOT NULL DEFAULT FALSE,  -- TRUE after emitted to shared DB
    bridged_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- CMS_CONFIG — Service configuration
-- =============================================================================
CREATE TABLE IF NOT EXISTS cms_config (
    key                 TEXT PRIMARY KEY,
    value               JSONB NOT NULL DEFAULT '{}',
    description         TEXT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Posts
CREATE INDEX IF NOT EXISTS idx_cms_posts_status ON cms_posts(status);
CREATE INDEX IF NOT EXISTS idx_cms_posts_category ON cms_posts(category);
CREATE INDEX IF NOT EXISTS idx_cms_posts_published ON cms_posts(published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_cms_posts_slug ON cms_posts(slug);

-- Media
CREATE INDEX IF NOT EXISTS idx_cms_media_post ON cms_media(post_id) WHERE post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cms_media_usage ON cms_media(usage);

-- Generations
CREATE INDEX IF NOT EXISTS idx_cms_generations_status ON cms_generations(status);
CREATE INDEX IF NOT EXISTS idx_cms_generations_post ON cms_generations(post_id) WHERE post_id IS NOT NULL;

-- Reviews
CREATE INDEX IF NOT EXISTS idx_cms_reviews_post ON cms_reviews(post_id, created_at DESC);

-- Events
CREATE INDEX IF NOT EXISTS idx_cms_events_type ON cms_events(event_type);
CREATE INDEX IF NOT EXISTS idx_cms_events_entity ON cms_events(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cms_events_unbridged ON cms_events(created_at) WHERE bridged = FALSE;

-- =============================================================================
-- SEED CONFIG
-- =============================================================================
INSERT INTO cms_config (key, value, description) VALUES
    ('default_model', '"claude-sonnet-4-20250514"', 'Default AI model for content generation'),
    ('default_temperature', '0.7', 'Default temperature for content generation'),
    ('auto_publish', 'false', 'Auto-publish approved content without manual publish step'),
    ('max_retries', '2', 'Max retry attempts for failed generations'),
    ('categories', '["tip","announcement","product_update","guide","resource","case_study"]', 'Available content categories'),
    ('system_prompt', '"You are a content writer for the SBIR Engine. Write clear, actionable content for small businesses pursuing federal R&D funding. Use short sentences. Be specific. No fluff. Focus on SBIR/STTR, proposal writing, and federal procurement strategy."', 'System prompt for AI content generation'),
    ('max_image_size_mb', '10', 'Maximum upload size for images in MB'),
    ('allowed_body_formats', '["markdown","html","plaintext"]', 'Supported body content formats')
ON CONFLICT (key) DO NOTHING;
