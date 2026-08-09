-- 164_heal_illegal_content_source.sql
--
-- Data remediation for the reuse-past content_source bug (found by the Canvas zero-trust sweep).
-- `reuse-past` wrote proposal_sections.content_source = 'library', a value NOT in the
-- canvas_versions.source CHECK (ai_draft | human_edit | ai_revision | library_import | template |
-- system). proposal_sections.content_source itself has no CHECK, so the write succeeded — but the
-- NEXT time such a section is archived (save / restore / accept-ai copy content_source into
-- canvas_versions.source), the INSERT throws the CHECK, the archive is caught non-fatal and DROPPED,
-- and the pre-write snapshot is lost (content-loss / broken undo history).
--
-- The route now writes the canonical 'library_import'. This heals any rows already poisoned so they
-- can be archived safely. Idempotent; also normalizes any other content_source value that is not a
-- legal canvas_versions.source to 'human_edit' (defensive — no other illegal origin is known).

UPDATE proposal_sections
SET content_source = 'library_import'
WHERE content_source = 'library';

UPDATE proposal_sections
SET content_source = 'human_edit'
WHERE content_source IS NOT NULL
  AND content_source NOT IN ('ai_draft', 'human_edit', 'ai_revision', 'library_import', 'template', 'system');
