-- 143_proposal_sort_index.sql
-- Numbering root fix, made durable. Section order was string-sorted by section_number
-- ("10".."14" landing before "2", unnumbered sections drifting), which the customer-facing
-- workspace, review page, per-volume export, and layout all inherited. The fix is a real
-- integer sort key (sort_index) that every section-ordering query now sorts on FIRST:
--   ORDER BY volume_number NULLS LAST, sort_index NULLS LAST, section_number
--
-- scripts/rebuild-tvsf.mjs already sets sort_index on the Foundation TVSF demo (Abstract=0,
-- Q1..14=1..14, letters=100/200). This migration adds the column for real (it was previously
-- only created ad-hoc by that script — so the new ORDER BY sort_index would fail on any deploy
-- that never ran it) and backfills every other proposal so their ordering is numeric too.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + a backfill that only touches NULL rows.

ALTER TABLE proposal_sections ADD COLUMN IF NOT EXISTS sort_index integer;

-- Backfill legacy rows: the leading integer of section_number is the sort key; unnumbered
-- sections (Abstract, cover, letters) get 0 so they sort first within their volume — volume_number
-- keeps separate-volume letters after the narrative regardless.
UPDATE proposal_sections
SET sort_index = CASE
    WHEN section_number ~ '^\s*[0-9]+'
      THEN (regexp_match(section_number, '^\s*([0-9]+)'))[1]::int
    ELSE 0
  END
WHERE sort_index IS NULL;

-- Index the ordering key so the workspace / review / export section fetches stay cheap.
CREATE INDEX IF NOT EXISTS idx_proposal_sections_order
  ON proposal_sections (proposal_id, volume_number, sort_index, section_number);
