-- 207 · The review queue learns SCOPE.
--
-- Comments went sub-section. Reviews never followed.
--
--   proposal_comments   proposal_id · section_id · anchor jsonb   (mig 183 — span/node anchors)
--   agent_task_queue    proposal_id · section_id                  (and nothing finer)
--
-- So the product already knew how to address a span — a comment can be pinned to one canvas node —
-- while a colour-team review could only ever be pointed at a whole section. `requestAiReview`
-- iterates `proposal_sections` and queues one `color_team_reviewer` task each, because `section_id`
-- was the only sub-proposal address the queue had. A reviewer could not be aimed at one figure, one
-- library-derived group, or the three pages an agency's page limit actually governs.
--
-- Two columns close that, and they mirror the anchor rather than inventing a parallel scheme:
--
--   scope_level  which rung of the ladder — node · group · section · pages · document
--   scope_ref    the address at that rung: {nodeId} · {groupId} · {pages:{start,end}}
--
-- NULL scope_level means WHOLE SECTION, and that is load-bearing rather than lazy. The existing
-- unscoped path writes neither column, so a row it produces after this migration is byte-identical
-- to one it produced before — no backfill, no behaviour change, nothing to re-verify on the live
-- path. An explicit section-scoped request DOES write 'section', because a deliberate choice is
-- worth recording; readers coalesce the two.
--
-- section_id is NOT dropped and NOT made optional. The pipeline's write-back
-- (fabric._post_section_recommendation) returns early without one, so a task with no section
-- produces no comment AND no error. Every scoped task therefore still carries the section its
-- finding lands in — the first section the scope covers when the scope is wider — and scope_ref
-- records what was really reviewed. Filing a page-range finding slightly too narrowly is recoverable;
-- losing it silently is not.
--
-- Idempotent.

ALTER TABLE agent_task_queue
  ADD COLUMN IF NOT EXISTS scope_level text,
  ADD COLUMN IF NOT EXISTS scope_ref   jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'agent_task_queue_scope_level_check'
      AND conrelid = 'agent_task_queue'::regclass
  ) THEN
    ALTER TABLE agent_task_queue
      ADD CONSTRAINT agent_task_queue_scope_level_check
      CHECK (scope_level IS NULL
             OR scope_level IN ('node', 'group', 'section', 'pages', 'document'));
  END IF;
END $$;

-- The rollup groups a proposal's reviews by SCOPE, not by section: several node-scoped tasks can
-- now share one section_id, and `DISTINCT ON (section_id)` would show one and hide the rest.
CREATE INDEX IF NOT EXISTS idx_atq_proposal_scope
  ON agent_task_queue (proposal_id, scope_level, created_at DESC)
  WHERE proposal_id IS NOT NULL;

COMMENT ON COLUMN agent_task_queue.scope_level IS
  'Rung of the canvas scope ladder this task addresses (lib/canvas/scope.ts). '
  'NULL = whole section, the pre-scope default — kept NULL by the unscoped path so its rows stay '
  'byte-identical to pre-migration ones.';
COMMENT ON COLUMN agent_task_queue.scope_ref IS
  'Address within scope_level: {nodeId} | {groupId} | {pages:{start,end}}. NULL for section and '
  'document, where the level plus section_id is the whole address. Mirrors proposal_comments.anchor.';
