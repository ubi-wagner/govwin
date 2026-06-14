-- =============================================================================
-- Migration 062: remove deprecated + junk marketing pages from content_pages
-- -----------------------------------------------------------------------------
-- engine / security / get-started are now redirects (their content was
-- consolidated — engine -> value), so they are no longer editable pages.
-- 'undefined' / 'null' / '' are junk rows created by a save against an invalid
-- page key (now guarded in the API). None of these are in the page registry, so
-- they will not re-seed. Removes all their versions so the admin list is clean.
-- =============================================================================

DELETE FROM content_pages
WHERE content_type = 'page'
  AND page_key IN ('engine', 'security', 'get-started', 'undefined', 'null', '');
