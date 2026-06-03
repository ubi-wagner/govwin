-- =============================================================================
-- Migration 056: repair double-encoded content_pages.blocks
-- -----------------------------------------------------------------------------
-- Before the sql.json fix, the editor stored blocks via JSON.stringify(...)::jsonb,
-- which the postgres.js client double-encoded — the column held a jsonb *string*
-- ("[{...}]") instead of a jsonb array. Those rows fail Array.isArray on read, so
-- the editor showed an empty page and the public read fell back to legacy content.
--
-- This converts any string-typed blocks back to a proper jsonb array by extracting
-- the inner text and re-parsing. Idempotent: only touches string-typed rows; arrays
-- are left alone.
-- =============================================================================

UPDATE content_pages
SET blocks = (blocks #>> '{}')::jsonb
WHERE jsonb_typeof(blocks) = 'string';
