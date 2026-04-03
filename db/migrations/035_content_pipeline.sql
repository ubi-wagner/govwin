-- =============================================================================
-- Migration 035 — Content Pipeline: AI Generation, HITL Review, Publishing
--
-- 100% segregated from site_content (page-level CMS). This system manages
-- blog posts, articles, tips, and announcements through an auditable pipeline:
--
--   Generate → Review → Approve/Reject → Publish → (optional Revert)
--
-- Fully event-driven via content_events with content_pipeline.* namespace.
-- All state transitions are immutable and auditable.
-- =============================================================================

-- =============================================================================
-- CONTENT POSTS — The canonical article/post entity
-- =============================================================================
CREATE TABLE IF NOT EXISTS content_posts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Identity
    slug                TEXT NOT NULL UNIQUE,
    title               TEXT NOT NULL,
    excerpt             TEXT,
    body                TEXT NOT NULL DEFAULT '',
    category            TEXT NOT NULL DEFAULT 'tip',
        -- tip, announcement, product_update, guide, resource, case_study
    tags                TEXT[] NOT NULL DEFAULT '{}',

    -- Workflow state
    status              TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','in_review','approved','rejected','published','reverted','archived')),

    -- Authorship
    author_id           TEXT REFERENCES users(id) ON DELETE SET NULL,
    author_name         TEXT,

    -- Generation provenance (NULL if manually written)
    generation_id       UUID,   -- FK added after content_generations created
    generated_by_model  TEXT,   -- e.g. 'claude-sonnet-4-20250514'
    generation_prompt   TEXT,   -- the prompt used

    -- Review
    reviewed_by         TEXT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMPTZ,
    review_notes        TEXT,

    -- Publishing
    published_at        TIMESTAMPTZ,
    published_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
    unpublished_at      TIMESTAMPTZ,

    -- SEO
    meta_title          TEXT,
    meta_description    TEXT,

    -- Version tracking
    version             INT NOT NULL DEFAULT 1,
    previous_body       TEXT,       -- body before last edit (for revert)
    previous_title      TEXT,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- CONTENT GENERATIONS — AI generation requests and outputs
-- =============================================================================
CREATE TABLE IF NOT EXISTS content_generations (
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
    post_id             UUID REFERENCES content_posts(id) ON DELETE SET NULL,

    -- Tracking
    requested_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
    tokens_used         INT,
    duration_ms         INT,
    error_message       TEXT,
    retry_count         INT NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at        TIMESTAMPTZ
);

-- Add FK from content_posts back to generations
ALTER TABLE content_posts
    ADD CONSTRAINT fk_content_posts_generation
    FOREIGN KEY (generation_id) REFERENCES content_generations(id)
    ON DELETE SET NULL;

-- =============================================================================
-- CONTENT REVIEWS — Immutable review decision log
-- =============================================================================
CREATE TABLE IF NOT EXISTS content_reviews (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id             UUID NOT NULL REFERENCES content_posts(id) ON DELETE CASCADE,

    -- Decision
    action              TEXT NOT NULL
        CHECK (action IN ('submit_review','approve','reject','request_changes','publish','unpublish','revert','archive')),
    reviewer_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notes               TEXT,

    -- Snapshot at time of review (for audit)
    title_snapshot      TEXT,
    body_snapshot       TEXT,
    version_at_review   INT NOT NULL DEFAULT 1,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Posts
CREATE INDEX IF NOT EXISTS idx_content_posts_status ON content_posts(status);
CREATE INDEX IF NOT EXISTS idx_content_posts_category ON content_posts(category);
CREATE INDEX IF NOT EXISTS idx_content_posts_published ON content_posts(published_at DESC) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_content_posts_slug ON content_posts(slug);
CREATE INDEX IF NOT EXISTS idx_content_posts_author ON content_posts(author_id) WHERE author_id IS NOT NULL;

-- Generations
CREATE INDEX IF NOT EXISTS idx_content_generations_status ON content_generations(status);
CREATE INDEX IF NOT EXISTS idx_content_generations_post ON content_generations(post_id) WHERE post_id IS NOT NULL;

-- Reviews
CREATE INDEX IF NOT EXISTS idx_content_reviews_post ON content_reviews(post_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reviews_reviewer ON content_reviews(reviewer_id);

-- =============================================================================
-- PIPELINE SCHEDULE — Content generation runs daily
-- =============================================================================
INSERT INTO pipeline_schedules (source, display_name, run_type, cron_expression, timezone, enabled, priority)
VALUES (
    'content_generation',
    'Content Pipeline — AI Generation',
    'full',
    '0 8 * * 1-5',   -- Weekdays at 8 AM UTC
    'UTC',
    FALSE,            -- Disabled by default; admin enables when ready
    50
)
ON CONFLICT (source) DO NOTHING;

-- =============================================================================
-- AUTOMATION RULES — Content pipeline event-driven workflow
-- =============================================================================

-- When AI generation completes, auto-create a draft post
INSERT INTO automation_rules (name, description, trigger_bus, trigger_event, conditions, action_type, action_config, enabled, cooldown_seconds)
VALUES (
    'content_pipeline.generation_completed',
    'When AI content generation completes, create draft post and notify admin for review',
    'content_events',
    'content_pipeline.generation.completed',
    '{}',
    'emit_event',
    '{"target_bus": "content_events", "event_type": "content_pipeline.post.draft_created", "include_source_metadata": true}',
    TRUE,
    0
)
ON CONFLICT (name) DO NOTHING;

-- When post is submitted for review, notify admin
INSERT INTO automation_rules (name, description, trigger_bus, trigger_event, conditions, action_type, action_config, enabled, cooldown_seconds)
VALUES (
    'content_pipeline.review_submitted',
    'Notify admin when content is submitted for review',
    'content_events',
    'content_pipeline.post.submitted_for_review',
    '{}',
    'queue_notification',
    '{"template": "content_review_needed", "recipients": ["admin"], "channel": "in_app"}',
    TRUE,
    0
)
ON CONFLICT (name) DO NOTHING;

-- When post is approved, auto-publish if configured
INSERT INTO automation_rules (name, description, trigger_bus, trigger_event, conditions, action_type, action_config, enabled, cooldown_seconds)
VALUES (
    'content_pipeline.auto_publish_on_approve',
    'Optionally auto-publish approved content (disabled by default)',
    'content_events',
    'content_pipeline.post.approved',
    '{}',
    'log_only',
    '{"note": "Enable action_type=emit_event to auto-publish on approval"}',
    FALSE,
    0
)
ON CONFLICT (name) DO NOTHING;

-- When post is published, log for audit
INSERT INTO automation_rules (name, description, trigger_bus, trigger_event, conditions, action_type, action_config, enabled, cooldown_seconds)
VALUES (
    'content_pipeline.published_audit',
    'Log all publish events for compliance audit trail',
    'content_events',
    'content_pipeline.post.published',
    '{}',
    'log_only',
    '{"audit": true, "note": "Content published — recorded in automation_log and content_reviews"}',
    TRUE,
    0
)
ON CONFLICT (name) DO NOTHING;

-- When post is rejected, notify for retry
INSERT INTO automation_rules (name, description, trigger_bus, trigger_event, conditions, action_type, action_config, enabled, cooldown_seconds)
VALUES (
    'content_pipeline.rejected_notify',
    'Notify when content is rejected so it can be revised or regenerated',
    'content_events',
    'content_pipeline.post.rejected',
    '{}',
    'queue_notification',
    '{"template": "content_rejected", "recipients": ["admin"], "channel": "in_app"}',
    TRUE,
    0
)
ON CONFLICT (name) DO NOTHING;

-- =============================================================================
-- SYSTEM CONFIG — Content pipeline settings
-- =============================================================================
INSERT INTO system_config (key, value, description, category)
VALUES
    ('content_pipeline.default_model', '"claude-sonnet-4-20250514"', 'Default AI model for content generation', 'content'),
    ('content_pipeline.default_temperature', '0.7', 'Default temperature for content generation', 'content'),
    ('content_pipeline.auto_publish', 'false', 'Auto-publish approved content without manual publish step', 'content'),
    ('content_pipeline.max_retries', '2', 'Max retry attempts for failed generations', 'content'),
    ('content_pipeline.categories', '["tip","announcement","product_update","guide","resource","case_study"]', 'Available content categories', 'content'),
    ('content_pipeline.system_prompt', '"You are a content writer for RFP Pipeline, the SBIR Engine. Write clear, actionable content for small businesses pursuing federal R&D funding. Use short sentences. Be specific. No fluff. Focus on SBIR/STTR, proposal writing, and federal procurement strategy."', 'System prompt for AI content generation', 'content')
ON CONFLICT (key) DO NOTHING;
