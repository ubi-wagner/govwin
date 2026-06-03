-- =============================================================================
-- Migration 057: bring documents into content_pages (unify the content store)
-- -----------------------------------------------------------------------------
-- blog_post / resource / guide / testimonial / team_member were individual rows
-- in cms_content, editable only via the legacy CMS. They now live in content_pages
-- as single-body, page-versioned documents — one store, one editor, one publish
-- flow. See ARCHITECTURE_V8.md.
-- =============================================================================

-- 1. Widen content_type to cover document kinds.
ALTER TABLE content_pages DROP CONSTRAINT IF EXISTS content_pages_content_type_check;
ALTER TABLE content_pages
    ADD CONSTRAINT content_pages_content_type_check
    CHECK (content_type IN ('page', 'blog_post', 'resource', 'guide', 'testimonial', 'team_member'));

-- 2. Active-uniqueness is now per (content_type, page_key), so a page and a doc
--    may share a slug without colliding.
DROP INDEX IF EXISTS uq_content_pages_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_content_pages_active
    ON content_pages (content_type, page_key) WHERE status = 'active';

-- 3. Backfill published documents from cms_content as active single-body versions.
--    The body lives in one block; tags / author / image / excerpt / externalUrl
--    ride in metadata. Pure SQL (same Main DB); idempotent on (content_type, slug).
INSERT INTO content_pages
    (page_key, content_type, version_no, status, title, blocks, metadata, audit_note, published_at, created_at)
SELECT
    c.slug,
    c.content_type,
    1,
    'active',
    c.title,
    jsonb_build_array(jsonb_build_object(
        'section',  'body',
        'title',    c.title,
        'body',     c.body,
        'excerpt',  c.excerpt,
        'metadata', COALESCE(c.metadata, '{}'::jsonb)
    )),
    jsonb_build_object(
        'tags',          to_jsonb(COALESCE(c.tags, '{}'::text[])),
        'author',        c.author,
        'featuredImage', c.featured_image,
        'externalUrl',   c.external_url,
        'excerpt',       c.excerpt
    ),
    'Backfilled document from cms_content (migration 057)',
    c.published_at,
    now()
FROM cms_content c
WHERE c.content_type IN ('blog_post', 'resource', 'guide', 'testimonial', 'team_member')
  AND c.status = 'published'
  AND NOT EXISTS (
      SELECT 1 FROM content_pages cp
      WHERE cp.page_key = c.slug AND cp.content_type = c.content_type AND cp.status = 'active'
  );
