-- 183 · Span/node-anchored comments (SPINE-T7)
-- A comment already belongs to a SECTION (proposal_comments.section_id). This adds an optional block
-- anchor so a comment can point at a specific node + the quoted span within that section, instead of
-- floating at the section level. Nullable + additive — every existing comment stays a section comment.
--   anchor = { "nodeId": "<canvas node id>", "quote": "<the highlighted text>" }
ALTER TABLE proposal_comments
  ADD COLUMN IF NOT EXISTS anchor jsonb;

-- Partial index for "comments anchored on THIS node" lookups (the section-scoped comment thread stays
-- on section_id; this only helps the node-anchor filter). Cheap — most comments have no anchor.
CREATE INDEX IF NOT EXISTS idx_proposal_comments_anchor_node
  ON proposal_comments ((anchor->>'nodeId'))
  WHERE anchor IS NOT NULL;

COMMENT ON COLUMN proposal_comments.anchor IS
  'SPINE-T7: optional block anchor {nodeId, quote} pinning the comment to a specific canvas node + span within its section. NULL = a plain section-level comment.';
