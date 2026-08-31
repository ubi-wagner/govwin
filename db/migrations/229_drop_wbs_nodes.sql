-- 229_drop_wbs_nodes.sql
--
-- The second half of migration 228: remove the superseded table, and close the one thing collapsing
-- the two spines quietly LOST.
--
-- ── THE GAP 228 OPENED ───────────────────────────────────────────────────────────────────────
-- `project_wbs_nodes` froze THREE baseline columns — `baseline_start`, `baseline_end` and
-- **`baseline_cost`** — under migration 216's immutability trigger. `project_milestones` freezes
-- exactly one: `baseline_date`. So after 228 the schedule promise was still held and the COST
-- promise was not, and `planned_cost` — freely editable, and moved by a rebaseline — was the only
-- cost number left.
--
-- That is not a missing feature, it is a wrong answer. `lib/projects/wbs.ts` renders a **read-only
-- "Baseline cost"** column in the workplan grid; with nothing to read it was aliasing
-- `planned_cost` into it. A person reading a column labelled "Baseline", greyed out because it
-- cannot be typed into, would be reading the current plan and told it was the promise — and cost
-- variance would compute as zero forever, cheerfully, because both sides of the subtraction were
-- the same column.
--
-- One date is enough for the schedule (a milestone is promised BY a date; `baseline_start` and
-- `baseline_end` on a node were two names for the segment `starts_on → forecast_date` already
-- carries). One cost is not derivable from anything. So: `baseline_cost` comes across, and the
-- trigger is re-declared to cover both columns.
--
-- ── AND THE DROP ─────────────────────────────────────────────────────────────────────────────
-- CLAUDE.md: drop only when superseded-with-a-successor AND zero live code refs. The successor is
-- migration 228; the refs were repointed in the same change; `grep` across the tree is clean of
-- `project_wbs_nodes` and `wbs_node_id` outside `.next` build output and the two migrations that
-- created and removed them. This is the only project table ever dropped.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

-- ── 1 · THE COST PROMISE ─────────────────────────────────────────────────────────────────────

ALTER TABLE project_milestones
  ADD COLUMN IF NOT EXISTS baseline_cost numeric(14,2);

COMMENT ON COLUMN project_milestones.baseline_cost IS
  'The cost promised at baseline — written once, never updated (the immutability trigger below). '
  'Cost variance is actual (other-direct + approved labour) against THIS, never against '
  'planned_cost, which a rebaseline is allowed to move.';

-- Carry across whatever the old nodes held, before the table goes. Same rule as 228 §3: nothing is
-- invented — a milestone that pointed at no node keeps its NULL, which reads as "not baselined yet"
-- and is true.
UPDATE project_milestones m
   SET baseline_cost = n.baseline_cost
  FROM project_wbs_nodes n
 WHERE n.id = m.wbs_node_id AND m.baseline_cost IS NULL AND n.baseline_cost IS NOT NULL;

-- Re-declared over BOTH columns. The function is generic over TG_ARGV (migration 216), so this is a
-- trigger redefinition and not a second rule — one place still decides what "frozen" means.
DROP TRIGGER IF EXISTS trg_milestone_baseline_immutable ON project_milestones;
CREATE TRIGGER trg_milestone_baseline_immutable
  BEFORE UPDATE ON project_milestones
  FOR EACH ROW
  EXECUTE FUNCTION project_baseline_is_immutable('baseline_date', 'baseline_cost');

-- ── 2 · THE OLD SPINE GOES ───────────────────────────────────────────────────────────────────
--
-- `wbs_node_id` first: it is the last thing pointing at the table, and dropping it separately means
-- the CASCADE below removes a table nothing references rather than reaching into a live column.
ALTER TABLE project_milestones DROP COLUMN IF EXISTS wbs_node_id;

-- CASCADE takes the table's own RLS policy, its indexes and migration 216's
-- `trg_wbs_baseline_immutable`. It reaches nothing else: `project_time_entries.wbs_node_id` was
-- already dropped in 228 §4, and no other table ever referenced it.
DROP TABLE IF EXISTS project_wbs_nodes CASCADE;

COMMENT ON TABLE project_milestones IS
  'THE WBS ELEMENT. A dated segment (starts_on → forecast_date) with an owner, a task checklist, '
  'deliverables and a completion record. clin_id groups it under a contract line item — CLIN 0002 '
  'having twelve monthly milestones is that column. There is no separate node tree: migration 228 '
  'collapsed project_wbs_nodes into this table and 229 dropped it.';
