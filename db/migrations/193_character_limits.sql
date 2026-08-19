-- 193 · Character limits are a first-class compliance dimension.
--
-- The compliance floor could measure PAGES, SLIDES and FONT SIZE — but a large family of
-- required documents is capped in CHARACTERS, not pages, and the product had no way to hold
-- that rule at all. The DoW 2026 SBIR BAA is the case that exposed it:
--
--   "The cover sheet must include a brief technical abstract that describes the proposed R&D
--    project and an anticipated benefits and potential commercial applications discussion.
--    Each section should be no more than 3,000 characters."
--
-- Those are two authored narrative documents (Project Summary / Technical Abstract, and
-- Anticipated Benefits), each hard-capped by the agency's submission portal, which simply
-- truncates or refuses at the cap. Without a character dimension the product would provision
-- them with no limit at all, the editor gauge would show pages for a document measured in
-- characters, and the export gate would pass a submission the agency will reject. The same
-- shape recurs across the portfolio: NSF project summaries, NIH abstracts, grants.gov
-- narrative fields.
--
-- Three columns, mirroring exactly how the page limit already travels:
--
--   solicitation_compliance.character_limit_narrative  the solicitation-level rule (what the
--       document itself states), read by the pattern extractor with a citation and badged with
--       its provenance like every other compliance value. Falls back to the item cap the same
--       way page_limit_technical does.
--   volume_required_items.character_limit              the per-item cap (each cover-sheet
--       narrative document carries its own).
--   proposal_sections.character_allocation             the budget provision writes onto the
--       authored section, the analog of page_allocation, so the editor gauge and the export
--       gate measure against the same number.

ALTER TABLE solicitation_compliance
  ADD COLUMN IF NOT EXISTS character_limit_narrative integer;

ALTER TABLE volume_required_items
  ADD COLUMN IF NOT EXISTS character_limit integer;

ALTER TABLE proposal_sections
  ADD COLUMN IF NOT EXISTS character_allocation integer;

COMMENT ON COLUMN solicitation_compliance.character_limit_narrative IS
  'Character cap the solicitation places on narrative summary documents (technical abstract, project summary, anticipated benefits). NULL = the solicitation states no character cap.';
COMMENT ON COLUMN volume_required_items.character_limit IS
  'Character cap for this required item. Overrides solicitation_compliance.character_limit_narrative for this item.';
COMMENT ON COLUMN proposal_sections.character_allocation IS
  'Character budget for this section, written at provision from the required item. The analog of page_allocation for character-capped documents.';
