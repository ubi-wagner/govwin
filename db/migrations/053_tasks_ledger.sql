-- Migration 053: Unified task ledger (ToDo queues for every role)
--
-- A ToDo is a parameterized TEMPLATE STEP (StepType.TODO): the static workflow
-- code declares "this is a human task"; the per-instance payload supplies the
-- specifics (who approves, the nudge cadence, the deadline, the UUID of the
-- thing to act on). It is the generalization of the HITL_WAIT gate — park-and-
-- wait PLUS an assignee, a nudge schedule, and an entity reference.
--
-- This table is the single source every landing-page queue reads:
--   SELECT * FROM tasks WHERE <assignee = me> AND status='open' ORDER BY due_at
-- and the deadline-nudge surface is the same rows where due_at is approaching.
--
-- Lives in the MAIN DB (not CMS admin_todos) so it serves all five roles with
-- normal tenant scoping (WHERE tenant_id = ...), and so the workflow engine can
-- write a task when an instance parks at a TODO step.

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Tenancy. NULL tenant_id = an admin/system task (rfp_admin queue), mirroring
    -- the events convention (admin events carry tenantId = null).
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,

    -- Assignee: a ROLE bucket ("any rfp_admin") and/or a SPECIFIC user. At least
    -- one is set. Role drives shared queues; user_id drives a named approver.
    assignee_role TEXT,                 -- master_admin|rfp_admin|tenant_admin|tenant_user|partner_user
    assignee_user_id UUID,              -- specific user (optional)

    -- What kind of task (admin_approval, content_publish, email_response, ...).
    -- Free text by design: new templates introduce new task_types without a
    -- schema change — the variability is in the data, not the code.
    task_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,

    -- The thing to act on (e.g. a content_pipeline row, a proposal, a diff).
    entity_type TEXT,
    entity_id UUID,

    -- Link back to the parked process instance + step, so completing the task
    -- resumes the workflow (force-advance / resume_instance) and so the ledger
    -- can show "this gate is waiting on a task".
    process_instance_id UUID REFERENCES process_instances(id) ON DELETE CASCADE,
    step_name TEXT,

    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled', 'expired')),

    -- Deadline + nudges. nudge_schedule is the per-instance cadence passed in via
    -- the payload, e.g. [1, 3, 5] (days before due_at to nudge). nudges_sent
    -- records which have fired so the sweep is idempotent.
    due_at TIMESTAMPTZ,
    nudge_schedule JSONB DEFAULT '[]'::jsonb,   -- e.g. [1, 3, 5] days-before-due
    nudges_sent JSONB DEFAULT '[]'::jsonb,      -- e.g. [5, 3] already fired

    -- Free-form per-task parameters from the payload, and the human's decision
    -- on completion (merged back into the instance payload on resume).
    params JSONB DEFAULT '{}'::jsonb,
    result JSONB,

    completed_by UUID,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Queue reads: "my open tasks, soonest due first" — the hot path for every
-- landing page. Partial index keeps it tight to actionable rows.
CREATE INDEX IF NOT EXISTS idx_tasks_role_queue
    ON tasks (assignee_role, tenant_id, due_at)
    WHERE status IN ('open', 'in_progress');

CREATE INDEX IF NOT EXISTS idx_tasks_user_queue
    ON tasks (assignee_user_id, due_at)
    WHERE status IN ('open', 'in_progress');

-- Nudge sweep: open tasks with a due date, scanned by the stuck-detection loop.
CREATE INDEX IF NOT EXISTS idx_tasks_nudge_sweep
    ON tasks (due_at)
    WHERE status IN ('open', 'in_progress') AND due_at IS NOT NULL;

-- Resume lookup: find the task for a parked instance/step.
CREATE INDEX IF NOT EXISTS idx_tasks_instance
    ON tasks (process_instance_id);

-- At least one assignee dimension must be present.
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assignee_present;
ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_present
    CHECK (assignee_role IS NOT NULL OR assignee_user_id IS NOT NULL);
