-- =============================================================================
-- Migration 055: content_pages — single page-versioned content store (V8)
-- -----------------------------------------------------------------------------
-- Collapses website content into ONE store in the Main DB. Each row is a page
-- VERSION; the public site reads the single `active` version per page. Editing
-- writes `draft` versions (whole-page snapshots with an audit note); publish
-- promotes a draft to active and archives the prior active. No cross-DB bridge.
-- See ARCHITECTURE_V8.md.
-- =============================================================================

CREATE TABLE IF NOT EXISTS content_pages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_key      TEXT NOT NULL,                       -- 'homepage', 'about', ... or a post slug
    content_type  TEXT NOT NULL DEFAULT 'page'
                  CHECK (content_type IN ('page', 'blog_post', 'resource')),
    version_no    INT  NOT NULL DEFAULT 1,
    status        TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'active', 'archived')),
    title         TEXT,
    blocks        JSONB NOT NULL DEFAULT '[]'::jsonb,  -- whole page: [{section, displayOrder, title, body, excerpt, metadata}]
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
    audit_note    TEXT,
    created_by    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at  TIMESTAMPTZ,
    archived_at   TIMESTAMPTZ
);

-- At most one active version per page.
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_pages_active
    ON content_pages (page_key) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_content_pages_page_key
    ON content_pages (page_key, version_no DESC);

-- ── Backfill: one active page-version per page from current published page blocks.
-- Pure SQL (same Main DB). Idempotent: skips pages that already have an active row.
INSERT INTO content_pages
    (page_key, content_type, version_no, status, title, blocks, audit_note, published_at, created_at)
SELECT
    (c.tags)[1]                                   AS page_key,
    'page',
    1,
    'active',
    (c.tags)[1],
    jsonb_agg(
        jsonb_build_object(
            'id',           c.id::text,
            'slug',         c.slug,
            'title',        c.title,
            'body',         c.body,
            'excerpt',      c.excerpt,
            'tags',         to_jsonb(c.tags),
            'section',      (c.tags)[2],
            'displayOrder', c.display_order,
            'metadata',     COALESCE(c.metadata, '{}'::jsonb)
        ) ORDER BY c.display_order
    ),
    'Backfilled from cms_content (migration 055)',
    now(),
    now()
FROM cms_content c
WHERE c.content_type = 'page_block'
  AND c.status = 'published'
  AND array_length(c.tags, 1) >= 1
  AND NOT EXISTS (
      SELECT 1 FROM content_pages cp
      WHERE cp.page_key = (c.tags)[1] AND cp.status = 'active'
  )
GROUP BY (c.tags)[1];
