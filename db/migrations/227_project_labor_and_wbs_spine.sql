-- 227_project_labor_and_wbs_spine.sql
--
-- Two things that belong together: the cost measure gets a source, and the WBS starts driving.
--
-- ══ PART 1 · THE WBS IS THE SPINE; THE CLIN IS A TAG ON IT ═══════════════════════════════════
--
-- A CLIN is the contract's accounting bucket. A WBS is how the work is actually broken up — and in
-- a real plan those are not the same shape: twelve monthly reports are twelve WBS nodes, each with
-- its own dates and its own cost, and all twelve are units of CLIN 0002.
--
-- The schema already modelled that on the WBS side: `project_wbs_nodes.clin_id` is inherited by
-- children, and `lib/projects/rollup.ts` resolves the effective CLIN with a recursive CTE.
--
-- MILESTONES DID NOT. `project_milestones` carries BOTH `clin_id` and `wbs_node_id`, and measured
-- on this box every milestone had a direct `clin_id` and **no `wbs_node_id` at all** — so the WBS
-- drove nothing for them, and a milestone could name CLIN 0001 while sitting under a WBS node
-- tagged CLIN 0002. Two answers to "what does this CLIN cover", both plausible, and the labour
-- roll-up added below would have made them visibly disagree.
--
-- The fix is not to delete the column — a milestone with no WBS node still needs a CLIN, and every
-- existing row is one of those. It is to make the two AGREE BY CONSTRUCTION: when a milestone hangs
-- off a WBS node, its CLIN is the node's effective CLIN, forced by a trigger. Attach a milestone to
-- the WBS and the CLIN follows; leave it detached and the direct tag still works.
--
-- ══ PART 2 · THE COST MEASURE GETS A SOURCE ══════════════════════════════════════════════════
--
-- `rollup.ts` reports cost against `project_wbs_nodes.actual_cost` — a column **nothing has ever
-- written**. The honest `null` → "not measured" it produces has been hiding a missing input, not a
-- missing number.
--
-- Time is logged against a WBS NODE, because that is the level the plan is costed at and the level
-- the CLIN roll-up already resolves. A task may be tagged as well, for people who want to know
-- which piece of work the hours went to, but the node is what carries the money.
--
-- ── AND WHY `actual_cost` IS NOT OVERWRITTEN ─────────────────────────────────────────────────
-- Two writers on one number is how a total becomes unexplainable. `actual_cost` keeps its existing
-- meaning — OTHER DIRECT COSTS entered against the node, travel and materials — and labour is
-- summed from approved time entries beside it. The rollup adds them and reports both, so a reader
-- can always see what a percentage was computed from.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

-- ── PART 1 ───────────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION project_milestone_clin_follows_wbs() RETURNS trigger AS $$
DECLARE
  node_id uuid;
  found   uuid;
  hops    int := 0;
BEGIN
  IF NEW.wbs_node_id IS NULL THEN
    RETURN NEW;   -- detached milestone: the direct tag stands
  END IF;

  -- Walk to the nearest ancestor carrying a CLIN — the same rule `rollup.ts` applies, so the
  -- milestone and the cost roll-up can never resolve a node differently.
  node_id := NEW.wbs_node_id;
  WHILE node_id IS NOT NULL AND hops < 100 LOOP
    SELECT clin_id, parent_id INTO found, node_id FROM project_wbs_nodes WHERE id = node_id;
    IF found IS NOT NULL THEN
      NEW.clin_id := found;
      RETURN NEW;
    END IF;
    hops := hops + 1;
  END LOOP;

  -- The node carries no CLIN anywhere up its chain. The milestone's own tag is left alone rather
  -- than blanked: a plan mid-construction should not lose information for being incomplete.
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_milestone_clin_follows_wbs ON project_milestones;
CREATE TRIGGER trg_project_milestone_clin_follows_wbs
  BEFORE INSERT OR UPDATE OF wbs_node_id, clin_id ON project_milestones
  FOR EACH ROW EXECUTE FUNCTION project_milestone_clin_follows_wbs();

COMMENT ON COLUMN project_milestones.clin_id IS
  'DERIVED when wbs_node_id is set — forced to the node''s effective CLIN by '
  'trg_project_milestone_clin_follows_wbs, so the milestone and the cost roll-up can never name '
  'different CLINs. Writable directly only for a milestone that hangs off no WBS node.';

-- ── PART 2 ───────────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_time_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id    uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

  -- The WBS node is REQUIRED. Hours with no place in the work breakdown cannot roll up to a CLIN,
  -- and a cost measure that silently drops them is worse than one that reports nothing.
  wbs_node_id   uuid NOT NULL REFERENCES project_wbs_nodes(id) ON DELETE CASCADE,
  -- Optional finer tag: which piece of work the hours went to.
  task_id       uuid REFERENCES project_milestone_tasks(id) ON DELETE SET NULL,

  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  worked_on     date NOT NULL,
  hours         numeric(6,2) NOT NULL,
  -- The rate AT THE TIME, copied in. A rate that is looked up later re-prices history every time
  -- somebody gets a raise, and last year's cost report stops matching last year's invoice.
  hourly_rate   numeric(10,2),
  cost          numeric(12,2) GENERATED ALWAYS AS (hours * COALESCE(hourly_rate, 0)) STORED,

  note          text,

  -- Logged by whoever did the work; APPROVED separately, because hours are what a customer is
  -- billed for and "somebody typed it" is not the same claim as "a manager checked it".
  approved_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at   timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_time_entries_hours_range CHECK (hours > 0 AND hours <= 24),
  CONSTRAINT project_time_entries_rate_positive CHECK (hourly_rate IS NULL OR hourly_rate >= 0),
  CONSTRAINT project_time_entries_note_len CHECK (note IS NULL OR length(note) <= 2000),
  -- Approval is a fact with a time, or it has not happened — the same pairing as every other
  -- decision in this module.
  CONSTRAINT project_time_entries_approved_pair
    CHECK ((approved_at IS NULL) = (approved_by IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_project_time_entries_node
  ON project_time_entries (wbs_node_id, worked_on);

CREATE INDEX IF NOT EXISTS idx_project_time_entries_mine
  ON project_time_entries (project_id, user_id, worked_on DESC);

-- The read the roll-up performs: approved labour per node.
CREATE INDEX IF NOT EXISTS idx_project_time_entries_approved
  ON project_time_entries (wbs_node_id)
  WHERE approved_at IS NOT NULL;

COMMENT ON TABLE project_time_entries IS
  'Labour actuals, logged against a WBS NODE (required) and optionally tagged with a task. This is '
  'the source the cost measure never had: rollup.ts reported against wbs.actual_cost, which nothing '
  'wrote. Only APPROVED entries count toward cost.';

COMMENT ON COLUMN project_time_entries.hourly_rate IS
  'The rate AT THE TIME, copied in rather than looked up. A rate resolved later re-prices history '
  'every time somebody gets a raise, and last year''s cost report stops matching last year''s invoice.';

COMMENT ON COLUMN project_wbs_nodes.actual_cost IS
  'OTHER DIRECT COSTS on this node — travel, materials. Labour is summed from approved '
  'project_time_entries and added by the roll-up, never written here: two writers on one number is '
  'how a total becomes unexplainable.';

-- RLS, forced, matching every other project table.
ALTER TABLE project_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_time_entries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_time_entries;
CREATE POLICY tenant_isolation_select ON project_time_entries FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_time_entries;
CREATE POLICY tenant_isolation_insert ON project_time_entries FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_time_entries;
CREATE POLICY tenant_isolation_update ON project_time_entries FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_time_entries;
CREATE POLICY tenant_isolation_delete ON project_time_entries FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_time_entries TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_time_entries TO rfp_agent;
