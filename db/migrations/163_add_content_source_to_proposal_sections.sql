-- 163_add_content_source_to_proposal_sections.sql
-- Track the provenance of a section's CURRENT live content so the version archive can label
-- history honestly (AI vs human) instead of hard-coding source='human_edit' on every archived
-- canvas_versions snapshot. The save route sets this to the incoming change's provenance on write
-- and sources the archive of the PRIOR content from it; the restore route sets it to the restored
-- version's provenance. NULL is read as 'human_edit'. Idempotent.

ALTER TABLE proposal_sections
  ADD COLUMN IF NOT EXISTS content_source text;

COMMENT ON COLUMN proposal_sections.content_source IS
  'Provenance of the current live content (human_edit | ai_draft | ai_revision | library | manual). Read by the save + restore routes to label the canvas_versions archive source honestly; NULL = human_edit.';
