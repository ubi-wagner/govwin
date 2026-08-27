-- 221_project_task_spine.sql
--
-- The task spine grows up: project-scope tasks, milestone-only dependencies, an assignee-owned
-- estimate, attached references, and a date rule the database enforces rather than hopes for.
--
-- ── WHY THE TABLE NAME STAYS `project_milestone_tasks` ───────────────────────────────────────
-- After this migration the table holds rows belonging to NO milestone, so the name is wrong in the
-- narrow sense. Renaming it would touch ~14 modules, the ToDo projection, both completion gates and
-- three harnesses, for zero behavioural gain. What a rename buys — a reader not being misled — is
-- bought instead by `scope` and by the COMMENTs below, which land in docs/SCHEMA_MAP.md because
-- that file is generated from the live database. A comment where the reader already is beats a
-- rename they have to notice.
--
-- ── WHY `scope` IS A COLUMN WHEN IT IS REDUNDANT ─────────────────────────────────────────────
-- `milestone_id IS NULL` already carries the same information, and the paired CHECK below keeps the
-- two identical forever. The column is not there for the data; it is there for the vocabulary:
-- `WHERE scope = 'project'` says what it selects, `WHERE milestone_id IS NULL` needs the reader to
-- know a convention. It is also the extension point — a third scope has somewhere to go, whereas a
-- NULL/NOT-NULL inference would force every existing query to change.
-- Redundancy without a guard is drift, so the guard is not optional decoration.
--
-- ── AND WHY NOT `task_type` ──────────────────────────────────────────────────────────────────
-- The platform `tasks` table already has `task_type`, with a completely different vocabulary
-- ('project_task', 'contract_kickoff', 'review', …), and project tasks are PROJECTED onto that
-- table by lib/projects/todos.ts. Two same-named columns with different vocabularies, one feeding
-- the other, is a trap laid for whoever debugs the projection next.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

-- ── 1 · SCOPE ────────────────────────────────────────────────────────────────────────────────

ALTER TABLE project_milestone_tasks ALTER COLUMN milestone_id DROP NOT NULL;

ALTER TABLE project_milestone_tasks
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'milestone';

DO $$ BEGIN
  ALTER TABLE project_milestone_tasks
    ADD CONSTRAINT project_milestone_tasks_scope_check
      CHECK (scope IN ('milestone', 'project'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The pair must agree in BOTH directions. Same idiom as `project_milestone_tasks_done_has_time`
-- on this table: a status and its stamp that can disagree will, eventually.
DO $$ BEGIN
  ALTER TABLE project_milestone_tasks
    ADD CONSTRAINT project_milestone_tasks_scope_matches_milestone
      CHECK ((scope = 'milestone') = (milestone_id IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON TABLE project_milestone_tasks IS
  'Project task list. Despite the name, a row need NOT belong to a milestone: scope=''project'' rows '
  'hang off the project directly and gate close-out only. Read `scope`, not `milestone_id IS NULL`. '
  'The name is kept deliberately — see migration 221.';

COMMENT ON COLUMN project_milestone_tasks.scope IS
  'milestone = gates its milestone''s completion; due_date must not fall after the milestone forecast '
  '(enforced by trigger). project = standing work; gates close-out only, no date rule.';

-- ── 2 · THE ASSIGNEE'S OWN ESTIMATE ──────────────────────────────────────────────────────────
--
-- `due_date` is what the manager asked for. `estimated_completion` is what the person doing the
-- work expects. They are different facts and the product already treats that distinction as
-- load-bearing one level up — baseline_date / forecast_date / met_at, three measures never blended.
--
-- THE DATE RULE BELOW BINDS `due_date` AND NEVER THIS COLUMN. An estimate that runs past the
-- milestone is exactly the early warning the field exists to surface; refusing it would teach people
-- to enter the date that is accepted rather than the date they believe, and the signal disappears.
ALTER TABLE project_milestone_tasks
  ADD COLUMN IF NOT EXISTS estimated_completion date;

COMMENT ON COLUMN project_milestone_tasks.estimated_completion IS
  'The assignee''s own forecast, deliberately NOT constrained by the milestone date. The gap between '
  'this and due_date is the early warning; constraining it would make people stop entering it honestly.';

-- ── 3 · MILESTONE-TO-MILESTONE DEPENDENCY ────────────────────────────────────────────────────
--
-- Dependencies exist between MILESTONES and nowhere else. There is no task-level predecessor graph
-- and no critical path: task-level dependency graphs are the feature that turns a plan into
-- something nobody maintains, and the value they add over "this phase follows that one" is small.
--
-- One predecessor, not many. `resequence` already treats the plan as a chain; this makes the chain
-- explicit where milestones run in parallel, so a reschedule can move SUCCESSORS rather than
-- "everything with a higher sort_index".
ALTER TABLE project_milestones
  ADD COLUMN IF NOT EXISTS depends_on_id uuid REFERENCES project_milestones(id) ON DELETE SET NULL;

-- ON DELETE SET NULL, not CASCADE: deleting a predecessor must not delete the work that followed it.

-- A BACKSTOP, and knowingly unreachable through the normal path: a BEFORE trigger runs ahead of
-- CHECK evaluation, so the cycle walk below catches a self-reference first and reports it as
-- `23003` — a loop of length one, which is what it is. This constraint fires only if that trigger is
-- dropped or disabled, which is exactly when a backstop earns its keep. (Found by exercising it:
-- the first probe expected `check_violation` here and got `23003`.)
DO $$ BEGIN
  ALTER TABLE project_milestones
    ADD CONSTRAINT project_milestones_no_self_dependency
      CHECK (depends_on_id IS NULL OR depends_on_id <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN project_milestones.depends_on_id IS
  'The milestone this one follows. Same project (23002), acyclic (23003) — both enforced by '
  'trg_project_milestone_dependency_sane, because a convention is enforced nowhere.';

-- Everything about a dependency except the self-reference backstop is cross-row, so it is a trigger.
-- Two things must hold and neither can be expressed as a column constraint:
--   · the predecessor is in the SAME project — a milestone id from another contract satisfies the
--     FK perfectly and would chain one customer's plan to another's;
--   · the chain is ACYCLIC — a cycle makes every consumer that walks it loop forever.
CREATE OR REPLACE FUNCTION project_milestone_dependency_sane() RETURNS trigger AS $$
DECLARE
  other_project uuid;
  hops int := 0;
  cursor_id uuid;
BEGIN
  IF NEW.depends_on_id IS NULL THEN RETURN NEW; END IF;

  SELECT project_id INTO other_project FROM project_milestones WHERE id = NEW.depends_on_id;
  IF other_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'A milestone can only depend on one in the same project'
      USING ERRCODE = '23002';
  END IF;

  -- Walk the chain from the proposed predecessor. If it reaches NEW.id, adding this edge closes a
  -- loop. Bounded by hops as well as by the walk, so a cycle that predates this trigger cannot hang
  -- the statement that would have rejected it.
  cursor_id := NEW.depends_on_id;
  WHILE cursor_id IS NOT NULL AND hops < 100 LOOP
    IF cursor_id = NEW.id THEN
      RAISE EXCEPTION 'That dependency would make a loop'
        USING ERRCODE = '23003';
    END IF;
    SELECT depends_on_id INTO cursor_id FROM project_milestones WHERE id = cursor_id;
    hops := hops + 1;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_milestone_dependency_sane ON project_milestones;
CREATE TRIGGER trg_project_milestone_dependency_sane
  BEFORE INSERT OR UPDATE OF depends_on_id, project_id ON project_milestones
  FOR EACH ROW EXECUTE FUNCTION project_milestone_dependency_sane();

-- ── 4 · THE DATE RULE ────────────────────────────────────────────────────────────────────────
--
-- A milestone-scoped task must not be due AFTER the milestone it leads up to.
--
-- Measured against `forecast_date` — the current plan. Not `baseline_date`, which mig 216's trigger
-- freezes and which describes a promise rather than a schedule; not `met_at`, which is the past.
--
-- `<=`, not `<`: a task due ON the milestone date is the normal case — the work finishes the day it
-- is due. Only a task due strictly after it is a plan that cannot happen.
--
-- A trigger rather than app-layer validation, for the same reason the baseline freeze is one: TWO
-- paths write these dates (editing the task, and rescheduling the milestone underneath it), and an
-- invariant that each path has to remember is an invariant enforced nowhere. A task with no due
-- date is legal — a task nobody dated is not a scheduling lie.
CREATE OR REPLACE FUNCTION project_task_due_within_milestone() RETURNS trigger AS $$
DECLARE
  gate date;
BEGIN
  IF NEW.scope <> 'milestone' OR NEW.due_date IS NULL OR NEW.milestone_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT forecast_date INTO gate FROM project_milestones WHERE id = NEW.milestone_id;
  IF gate IS NOT NULL AND NEW.due_date > gate THEN
    RAISE EXCEPTION 'Task "%" is due % — after its milestone (%)', NEW.title, NEW.due_date, gate
      USING ERRCODE = '23004';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_task_due_within_milestone ON project_milestone_tasks;
CREATE TRIGGER trg_project_task_due_within_milestone
  BEFORE INSERT OR UPDATE OF due_date, milestone_id, scope ON project_milestone_tasks
  FOR EACH ROW EXECUTE FUNCTION project_task_due_within_milestone();

-- The other direction: pulling a milestone IN can strand tasks that were legal a moment ago.
--
-- It REFUSES and names them rather than dragging the dates along. Silently moving a date somebody
-- committed to is how a scheduling tool stops being trusted — the caller can offer to move them,
-- and then it is a decision rather than a side effect. Same shape as the TASKS_OUTSTANDING refusal.
CREATE OR REPLACE FUNCTION project_milestone_pull_in_guard() RETURNS trigger AS $$
DECLARE
  stranded text;
  n int;
BEGIN
  IF NEW.forecast_date IS NULL
     OR OLD.forecast_date IS NOT DISTINCT FROM NEW.forecast_date
     OR (OLD.forecast_date IS NOT NULL AND NEW.forecast_date >= OLD.forecast_date) THEN
    RETURN NEW;
  END IF;

  SELECT count(*), string_agg(title, ', ' ORDER BY sort_index)
    INTO n, stranded
    FROM (SELECT title, sort_index FROM project_milestone_tasks
           WHERE milestone_id = NEW.id AND scope = 'milestone'
             AND due_date IS NOT NULL AND due_date > NEW.forecast_date
           ORDER BY sort_index LIMIT 3) s;

  IF n > 0 THEN
    RAISE EXCEPTION '% task(s) would be due after the new date: %', n, stranded
      USING ERRCODE = '23005';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_project_milestone_pull_in_guard ON project_milestones;
CREATE TRIGGER trg_project_milestone_pull_in_guard
  BEFORE UPDATE OF forecast_date ON project_milestones
  FOR EACH ROW EXECUTE FUNCTION project_milestone_pull_in_guard();

-- ── 5 · REFERENCE ATTACHMENTS ────────────────────────────────────────────────────────────────
--
-- A task can carry files. Nothing but a deliverable could hold one before, so "here is the drawing
-- I was asked about" had nowhere to go except a deliverable it was not.
--
-- AN ATTACHMENT IS A REFERENCE, NOT EVIDENCE OF COMPLETION. It must never touch `status` — the same
-- separation that keeps `uploadDeliverable` from setting `accepted_at`. A file appearing is not work
-- finishing, and a system that conflated them would let a checklist close itself.
CREATE TABLE IF NOT EXISTS project_task_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id      uuid NOT NULL REFERENCES project_milestone_tasks(id) ON DELETE CASCADE,
  filename     text NOT NULL,
  storage_key  text NOT NULL,
  content_type text,
  byte_size    bigint,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_task_attachments_filename_check CHECK (length(filename) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS idx_project_task_attachments_task
  ON project_task_attachments (task_id, uploaded_at DESC);

COMMENT ON TABLE project_task_attachments IS
  'Reference files on a project task. A reference, never evidence of completion — nothing here may '
  'move task status, the same separation that keeps uploading a deliverable from accepting it.';

-- RLS, forced, matching every other project table (mig 216 · 218).
ALTER TABLE project_task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_task_attachments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_select ON project_task_attachments;
CREATE POLICY tenant_isolation_select ON project_task_attachments FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid OR tenant_id IS NULL);

DROP POLICY IF EXISTS tenant_isolation_insert ON project_task_attachments;
CREATE POLICY tenant_isolation_insert ON project_task_attachments FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_update ON project_task_attachments;
CREATE POLICY tenant_isolation_update ON project_task_attachments FOR UPDATE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_delete ON project_task_attachments;
CREATE POLICY tenant_isolation_delete ON project_task_attachments FOR DELETE
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON project_task_attachments TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON project_task_attachments TO rfp_agent;
