-- 228_milestones_are_the_wbs.sql
--
-- The WBS **is** the milestone list. Stated plainly by the product owner:
--
--   "1 project is the portal. It has high level information like participants and contact upload
--    and summary and start and end dates. Then the WBS are the milestones with tasks and
--    deliverables. The deliverables on any milestone could be CLINs from the contract."
--
-- ── WHAT WAS WRONG ───────────────────────────────────────────────────────────────────────────
-- `project_wbs_nodes` was a SECOND hierarchy sitting beside `project_milestones`, carrying its own
-- dates, its own costs and its own CLIN — a parallel structure for the same thing. That is the
-- shape this module has refused five times in other places (a second ToDo queue, a second nudge
-- path, a second editor, a second checklist, a second comment table), and it was sitting in the
-- middle of the schema the whole time.
--
-- It also produced two answers to the same question. Migration 227 tried to reconcile them with a
-- trigger forcing a milestone's CLIN to follow its WBS node — the right fix for the wrong model,
-- and it is dropped here, hours old. The model does not need reconciling; it needs one spine.
--
-- ── THE SHAPE ────────────────────────────────────────────────────────────────────────────────
--
--   projects                the portal: participants, contract documents, summary, dates
--     └── project_milestones            = THE WBS ELEMENT
--           · code, dates, owner, cost, completion record
--           · clin_id  — the GROUPING: CLIN 0002 has twelve monthly milestones
--           ├── project_milestone_tasks
--           └── project_deliverables
--                 · clin_id — the CONTRACTUAL ITEM this deliverable satisfies
--
-- Two CLIN links, and they are different claims. A milestone's CLIN says *which line item this
-- month's work is under*. A deliverable's CLIN says *this is the thing the contract asked for*. A
-- monthly milestone under CLIN 0002 whose deliverable is the CLIN 0002 report will carry the same
-- id twice; a milestone under CLIN 0001 that happens to produce a CLIN 0002 artefact will not, and
-- collapsing them would lose that.
--
-- ── AND WHY THE OLD TABLE IS NOT DROPPED HERE ────────────────────────────────────────────────
-- CLAUDE.md: drop only when superseded-with-a-successor AND zero live code refs. The successor
-- exists as of this file; the refs are repointed in the same change; the DROP is migration 229, so
-- that the code and the schema never disagree in between.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

-- ── 1 · THE MILESTONE BECOMES THE WBS ELEMENT ────────────────────────────────────────────────

ALTER TABLE project_milestones
  ADD COLUMN IF NOT EXISTS code          text,
  ADD COLUMN IF NOT EXISTS planned_cost  numeric(14,2),
  -- OTHER DIRECT COST — travel, materials. Labour is summed from approved time entries and added
  -- by the roll-up, never written here: two writers on one number is how a total stops being
  -- explainable (mig 227).
  ADD COLUMN IF NOT EXISTS actual_cost   numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN project_milestones.code IS
  'The WBS number — "2.3". The milestone IS the WBS element; there is no separate node tree.';
COMMENT ON COLUMN project_milestones.clin_id IS
  'The line item this milestone''s work sits under — the GROUPING. CLIN 0002 having twelve monthly '
  'milestones is this column. Distinct from project_deliverables.clin_id, which names the '
  'contractual item a deliverable satisfies.';

-- Mig 227's reconciliation trigger is superseded: with one spine there is nothing to reconcile.
DROP TRIGGER IF EXISTS trg_project_milestone_clin_follows_wbs ON project_milestones;
DROP FUNCTION IF EXISTS project_milestone_clin_follows_wbs();

-- ── 2 · THE DELIVERABLE NAMES ITS CLIN ───────────────────────────────────────────────────────

ALTER TABLE project_deliverables
  ADD COLUMN IF NOT EXISTS clin_id uuid REFERENCES project_clins(id) ON DELETE SET NULL;

COMMENT ON COLUMN project_deliverables.clin_id IS
  'The contractual item this deliverable satisfies — "the deliverables on any milestone could be '
  'CLINs from the contract". ON DELETE SET NULL: removing a CLIN from the contract must not delete '
  'the artefact somebody produced.';

CREATE INDEX IF NOT EXISTS idx_project_deliverables_clin
  ON project_deliverables (clin_id) WHERE clin_id IS NOT NULL;

-- ── 3 · CARRY THE OLD NODES ACROSS ───────────────────────────────────────────────────────────
--
-- Where a milestone already pointed at a node, take that node's WBS attributes. Nothing is
-- invented: a milestone with no node keeps its own values, and a node nothing pointed at is left
-- behind rather than promoted into a milestone somebody never wrote.
UPDATE project_milestones m
   SET code         = COALESCE(m.code, n.code),
       planned_cost = COALESCE(m.planned_cost, n.planned_cost),
       actual_cost  = GREATEST(m.actual_cost, COALESCE(n.actual_cost, 0)),
       clin_id      = COALESCE(m.clin_id, n.clin_id)
  FROM project_wbs_nodes n
 WHERE n.id = m.wbs_node_id;

-- A deliverable with no CLIN of its own inherits its milestone's, which is the common case: the
-- monthly report under the monthly milestone under CLIN 0002.
UPDATE project_deliverables d
   SET clin_id = m.clin_id
  FROM project_milestones m
 WHERE m.id = d.milestone_id AND d.clin_id IS NULL AND m.clin_id IS NOT NULL;

-- ── 4 · TIME GOES TO THE MILESTONE ───────────────────────────────────────────────────────────
--
-- Migration 227 hung labour off a WBS node, which was the level the plan was costed at under the
-- old model. Under this one the milestone is that level.
ALTER TABLE project_time_entries
  ADD COLUMN IF NOT EXISTS milestone_id uuid REFERENCES project_milestones(id) ON DELETE CASCADE;

UPDATE project_time_entries e
   SET milestone_id = m.id
  FROM project_milestones m
 WHERE m.wbs_node_id = e.wbs_node_id AND e.milestone_id IS NULL;

-- Entries whose node maps to no milestone would silently stop counting toward cost, and a cost
-- measure that drops hours is worse than one reporting nothing. There are none in any environment
-- this has run in (mig 227 shipped hours ago with an empty table), so this refuses rather than
-- guessing where they belong.
DO $$
DECLARE orphans int;
BEGIN
  SELECT count(*) INTO orphans FROM project_time_entries WHERE milestone_id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION '% time entr(ies) have no milestone to move to. Assign them before migrating — '
      'silently dropping hours from the cost measure is the one thing this must not do.', orphans;
  END IF;
END $$;

ALTER TABLE project_time_entries ALTER COLUMN milestone_id SET NOT NULL;
ALTER TABLE project_time_entries DROP COLUMN IF EXISTS wbs_node_id;

CREATE INDEX IF NOT EXISTS idx_project_time_entries_milestone
  ON project_time_entries (milestone_id, worked_on);
CREATE INDEX IF NOT EXISTS idx_project_time_entries_approved_ms
  ON project_time_entries (milestone_id) WHERE approved_at IS NOT NULL;

COMMENT ON TABLE project_time_entries IS
  'Labour actuals, logged against a MILESTONE (the WBS element) and optionally tagged with a task. '
  'Only APPROVED entries count toward cost.';
