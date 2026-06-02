-- =============================================================================
-- Migration 010: Page blocks live in cms_posts (CRM-CMS staging + version store)
-- -----------------------------------------------------------------------------
-- Page blocks used to be edited directly in Main Postgres cms_content (the
-- public reference), which let unpublished drafts disturb the live site. They
-- now stage and version in cms_posts like every other content type; publish
-- bridges them to cms_content (the public reference) on "that side of the house".
--
-- cms_posts was modelled for articles, so page blocks need two more columns:
--   - metadata      : structured block fields (hero CTA, stats, pricing, _versions)
--   - display_order : positional ordering within a page / section
-- and the status CHECK is widened to include 'pending' so the page-block
-- workflow (draft -> pending -> published) maps cleanly onto cms_posts.
-- =============================================================================

ALTER TABLE cms_posts
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE cms_posts
    ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;

-- Widen the workflow vocabulary to include the page-block review state.
ALTER TABLE cms_posts DROP CONSTRAINT IF EXISTS cms_posts_status_check;
ALTER TABLE cms_posts
    ADD CONSTRAINT cms_posts_status_check
    CHECK (status IN ('draft','pending','in_review','approved','rejected','published','reverted','archived'));

-- Fast lookup of page blocks by page tag + order.
CREATE INDEX IF NOT EXISTS idx_cms_posts_page_blocks
    ON cms_posts (category, display_order)
    WHERE category = 'page_block';
