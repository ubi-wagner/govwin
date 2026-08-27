-- 218_project_milestone_tasks.sql
--
-- The milestone becomes the unit of project management: a dated segment of work with a checklist,
-- an owner, and a completion record.
--
-- ── THE CONSTRUCT, AND WHY IT IS ONE THING AND NOT THREE ─────────────────────────────────────
-- Migration 216 gave a milestone a date and a bag of deliverables (files someone accepts). That is
-- the contract-administration half. It is not how the work gets DONE, and it left the smallest
-- useful case unbuildable: a company that has won something and just wants a dated list of jobs
-- with names against them.
--
-- So a milestone gets a **task list**, and the shape scales in one direction only:
--
--     one milestone   = a dated ToDo list with an owner, notifications and nudges
--     N milestones    = the same thing, in series — each starting where the last one ends
--
-- There is no separate "simple project" mode to keep in step with a "real" one. A phase plan is a
-- one-milestone project with more milestones added, which is what makes it extendable rather than
-- merely configurable.
--
-- ── SERIAL DATES ARE A DEFAULT, NOT A CONSTRAINT ─────────────────────────────────────────────
-- `starts_on` is new here and the app derives it from the previous milestone's end when it is not
-- pinned, so a plan reads as a chain. It is a *default*, not a database rule: real plans overlap,
-- and a schema that forbade it would be wrong more often than it was helpful. What the database
-- does enforce is the one thing that is always true — a segment cannot end before it starts.
--
-- ── WHAT IS NOT BASELINED, DELIBERATELY ──────────────────────────────────────────────────────
-- Mig 216's trigger freezes `baseline_date` — the promised END. `starts_on` is planning, not a
-- promise, and stays freely editable, as does the task list. Freezing the plan should not freeze
-- the work breakdown, or a rebaseline becomes an argument about who owns a checklist.
--
-- ── COMPLETION IS A RECORD, NOT A FLAG ───────────────────────────────────────────────────────
-- `completion_note` and `completion_metrics` exist because "met" on its own is unreadable six
-- months later. The note is what a person wants to say; the metrics are whatever that milestone
-- actually measured (units shipped, tests passed, hours) as an open jsonb — the shape varies by
-- contract and a column per metric would be a schema change per customer.

-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction, and wrapping it
-- again makes the file's COMMIT close the runner's — which is what the
-- "there is no transaction in progress" warning on the first apply was saying out loud.

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 1 · The checklist
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- `tenant_id NOT NULL` directly on the row, never by lineage through the milestone — mig 216's
-- rule, for mig 212's reason: a column-shaped audit can see this, a join cannot.
--
-- `project_id` is denormalised alongside `milestone_id` so the sweep and the workspace can scope by
-- project without a join, and so a task can never be silently re-parented into another project's
-- milestone (the app checks both).
--
-- Assignment is a PERSON **or** a ROLE, never both required. A small company assigns "whoever is
-- the tenant_admin"; a larger one assigns Dana. Modelling only the person makes the first case
-- impossible and modelling only the role makes the second useless.
CREATE TABLE IF NOT EXISTS project_milestone_tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id      uuid NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,

  title             text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 500),
  detail            text,

  assignee_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  assignee_role     text CHECK (assignee_role IN ('tenant_admin', 'tenant_user')),
  due_date          date,

  status            text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'done', 'blocked')),
  blocked_reason    text,
  completed_at      timestamptz,
  completed_by      uuid REFERENCES users(id) ON DELETE SET NULL,

  -- Nudge watermark, per task. Bounded here rather than in the sweep so the bound survives a
  -- rewritten sweep — the same reason mig 181 put `start_nudges_sent` on the card.
  nudges_sent       integer NOT NULL DEFAULT 0,
  last_nudged_at    timestamptz,

  sort_index        integer NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- A done task has a time; an open one does not. Without this the two disagree the first time
  -- someone flips a status without clearing the stamp, and every "when was this finished" report
  -- quietly reads the stale one.
  CONSTRAINT project_milestone_tasks_done_has_time
    CHECK ((status = 'done') = (completed_at IS NOT NULL)),
  CONSTRAINT project_milestone_tasks_blocked_has_reason
    CHECK (status <> 'blocked' OR blocked_reason IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_project_milestone_tasks_milestone
  ON project_milestone_tasks (milestone_id, sort_index);
CREATE INDEX IF NOT EXISTS idx_project_milestone_tasks_project
  ON project_milestone_tasks (project_id, status);
-- The sweep's index: open, dated, not yet nudged out.
CREATE INDEX IF NOT EXISTS idx_project_milestone_tasks_due
  ON project_milestone_tasks (due_date)
  WHERE status = 'open' AND due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_project_milestone_tasks_assignee
  ON project_milestone_tasks (assignee_user_id)
  WHERE assignee_user_id IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 2 · The milestone grows a start, an owner, and a completion record
-- ═════════════════════════════════════════════════════════════════════════════════════════════
ALTER TABLE project_milestones
  ADD COLUMN IF NOT EXISTS starts_on           date,
  ADD COLUMN IF NOT EXISTS owner_user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS completion_note     text,
  ADD COLUMN IF NOT EXISTS completion_metrics  jsonb,
  ADD COLUMN IF NOT EXISTS nudges_sent         integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_nudged_at      timestamptz;

-- The one thing that is always true. Overlap between milestones is allowed (see the header); a
-- segment that ends before it begins is not.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_milestones_window_ordered'
  ) THEN
    ALTER TABLE project_milestones
      ADD CONSTRAINT project_milestones_window_ordered
      CHECK (starts_on IS NULL OR forecast_date IS NULL OR forecast_date >= starts_on);
  END IF;
END $$;

-- `completion_metrics` is an OBJECT, not a scalar or an array. Written through `sql.json(...)` it
-- always is; this stops the one bug class that shape has produced repeatedly in this repo — a
-- string that reads back as a string and then char-iterates.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'project_milestones_metrics_is_object'
  ) THEN
    ALTER TABLE project_milestones
      ADD CONSTRAINT project_milestones_metrics_is_object
      CHECK (completion_metrics IS NULL OR jsonb_typeof(completion_metrics) = 'object');
  END IF;
END $$;

-- The sweep's index on the milestone side.
CREATE INDEX IF NOT EXISTS idx_project_milestones_pending_due
  ON project_milestones (forecast_date)
  WHERE status = 'pending' AND forecast_date IS NOT NULL;

-- ═════════════════════════════════════════════════════════════════════════════════════════════
-- 3 · RLS, in the same statement block that created the table
-- ═════════════════════════════════════════════════════════════════════════════════════════════
--
-- Mig 216's rule and its reason: a table that ships without a policy has to be retrofitted later,
-- and migrations 184/212/213 are what that costs. Strict tenant equality, no platform arm — a
-- project task belongs to exactly one tenant.
ALTER TABLE public.project_milestone_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_milestone_tasks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.project_milestone_tasks;
CREATE POLICY tenant_isolation ON public.project_milestone_tasks
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

