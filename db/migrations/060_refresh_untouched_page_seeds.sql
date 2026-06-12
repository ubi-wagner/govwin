-- =============================================================================
-- Migration 060: refresh untouched auto-seeded marketing pages
-- -----------------------------------------------------------------------------
-- The launch-readiness copy overhaul changed the in-code page defaults and the
-- content_pages registry. Pages that were AUTO-seeded during testing (the editor
-- writes created_by='system', audit_note='Seeded from page defaults') still hold
-- the OLD copy and would override the new render.
--
-- Delete only those untouched auto-seeds so the public site falls back to the
-- fresh in-code defaults; the admin editor re-seeds from the new registry on next
-- open. Any human-published version (different created_by / audit_note) is
-- preserved — we never delete real edits. Also clears the now-removed 'engine'
-- auto-seed so it stops appearing as an editable page.
-- =============================================================================

DELETE FROM content_pages
WHERE content_type = 'page'
  AND created_by = 'system'
  AND audit_note = 'Seeded from page defaults';
