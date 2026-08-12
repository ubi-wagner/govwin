-- 174_tasks_broadcast_assignee.sql
-- Allow a TENANT BROADCAST ToDo: a task with NO named assignee (assignee_role AND assignee_user_id
-- both NULL) that targets the whole tenant. Every member of the tenant — and a descended shadow admin
-- or partner-manager, treated as its admin — receives it and acknowledges INDEPENDENTLY (a per-user
-- receipt in result.receipts, so one ack never clears it for the others).
--
-- The old `tasks_assignee_present` CHECK required a role or a user on every row. Relax it to also
-- permit both-NULL WHEN the task is tenant-scoped (tenant_id IS NOT NULL). The invariant still holds
-- for ADMIN tasks: a null-tenant task MUST still name an assignee — there is no global/all-admins
-- broadcast (that would target every admin across the platform).
--
-- Paired with lib/tasks/tasks.ts (createTask `broadcast`, listOpenTasksForActor broadcast visibility,
-- completeTask per-user receipt) + the tenant-portal compose form (broadcast | named-to-user).
-- Idempotent: drop-if-exists then re-add.

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_assignee_present;

ALTER TABLE tasks ADD CONSTRAINT tasks_assignee_present
  CHECK (
    assignee_role IS NOT NULL
    OR assignee_user_id IS NOT NULL
    OR tenant_id IS NOT NULL   -- a tenant broadcast: no named assignee, scoped to one tenant
  );
