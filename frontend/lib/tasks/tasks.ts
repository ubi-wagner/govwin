/**
 * Task ledger — shared query + completion core for the unified `tasks` table.
 *
 * A task is the surfaced form of a parked TODO step (see migration 053 +
 * pipeline manager._create_task). This module is the single place the frontend
 * reads a role/user's queue and completes a task — completion mirrors the
 * pipeline `WorkflowManager.complete_task`: close the task, then resume the
 * parked instance (paused → retrying) with the human's decision merged into the
 * step result. It reuses forceAdvanceProcess for the resume so there is exactly
 * one paused→retrying transition path in the frontend.
 */
import { sql } from '@/lib/db';
import { forceAdvanceProcess } from '@/lib/process/force-advance';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';

export interface TaskRow {
  id: string;
  tenantId: string | null;
  assigneeRole: string | null;
  assigneeUserId: string | null;
  taskType: string;
  title: string;
  description: string | null;
  entityType: string | null;
  entityId: string | null;
  processInstanceId: string | null;
  stepName: string | null;
  status: string;
  dueAt: string | null;
  nudgeSchedule: number[] | null;
  params: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * The actor's open task queue. A task is visible if it targets the actor's role
 * bucket OR the actor specifically. Tenancy: admins (rfp_admin+) see admin tasks
 * (tenant_id IS NULL) plus, when a tenant is given, that tenant's; tenant users
 * see only their own tenant's. Soonest-due first — the natural urgency order.
 */
export async function listOpenTasksForActor(opts: {
  id: string;
  role: Role;
  tenantId: string | null;
}): Promise<TaskRow[]> {
  const { id: userId, role, tenantId } = opts;
  const isAdmin = hasRoleAtLeast(role, 'rfp_admin');

  // NOTE: postgres.js treats ${} as a PARAM binding, not code — branch tenant
  // scope in JS, never with a ternary inside the tagged template. Columns are
  // inlined in both branches (house style; no sql-fragment composition).
  // Assignee match (both branches): my role bucket OR me by id.
  if (isAdmin) {
    // Admins see admin-scoped tasks (tenant_id IS NULL), plus a specific
    // tenant's when one is in context.
    return await sql<TaskRow[]>`
      SELECT id, tenant_id, assignee_role, assignee_user_id, task_type, title,
             description, entity_type, entity_id, process_instance_id, step_name,
             status, due_at, nudge_schedule, params, created_at
      FROM tasks
      WHERE status IN ('open', 'in_progress')
        AND (assignee_role = ${role} OR assignee_user_id = ${userId}::uuid)
        AND (tenant_id IS NULL
             OR ${tenantId}::uuid IS NULL
             OR tenant_id = ${tenantId}::uuid)
      ORDER BY due_at ASC NULLS LAST, created_at ASC
      LIMIT 200
    `;
  }

  // Tenant users are pinned to their own tenant.
  return await sql<TaskRow[]>`
    SELECT id, tenant_id, assignee_role, assignee_user_id, task_type, title,
           description, entity_type, entity_id, process_instance_id, step_name,
           status, due_at, nudge_schedule, params, created_at
    FROM tasks
    WHERE status IN ('open', 'in_progress')
      AND (assignee_role = ${role} OR assignee_user_id = ${userId}::uuid)
      AND tenant_id = ${tenantId}::uuid
    ORDER BY due_at ASC NULLS LAST, created_at ASC
    LIMIT 200
  `;
}

export type CompleteTaskResult =
  | { ok: true; data: { taskId: string; resumed: boolean } }
  | { ok: false; status: number; error: string; code: string };

/**
 * Complete a task and resume its parked instance. Authorization is the SAME
 * predicate as force-advance (canForceAdvanceInstance, via forceAdvanceProcess):
 * admins anywhere, tenant_admin within their own tenant. The completer must also
 * actually be an assignee of the task (role bucket or user) — enforced here so a
 * tenant_admin can't close another team's task within the same tenant unless it
 * targets their role.
 */
export async function completeTask(opts: {
  taskId: string;
  result?: Record<string, unknown>;
  actor: { id: string; email: string | null; role: Role; tenantId: string | null };
}): Promise<CompleteTaskResult> {
  const { taskId, result, actor } = opts;

  const rows = await sql<{
    id: string;
    status: string;
    tenantId: string | null;
    assigneeRole: string | null;
    assigneeUserId: string | null;
    processInstanceId: string | null;
  }[]>`
    SELECT id, status, tenant_id, assignee_role, assignee_user_id, process_instance_id
    FROM tasks WHERE id = ${taskId}::uuid
  `;
  if (rows.length === 0) {
    return { ok: false, status: 404, error: 'Task not found', code: 'NOT_FOUND' };
  }
  const task = rows[0];
  if (task.status !== 'open' && task.status !== 'in_progress') {
    return { ok: false, status: 409, error: `Task is already ${task.status}`, code: 'TASK_CLOSED' };
  }

  // Must be an assignee of this task.
  const isAssignee =
    (task.assigneeRole && task.assigneeRole === actor.role) ||
    (task.assigneeUserId && task.assigneeUserId === actor.id);
  if (!isAssignee) {
    return { ok: false, status: 403, error: 'Not an assignee of this task', code: 'FORBIDDEN' };
  }

  // Close the task (guarded against a lost race).
  const closed = await sql<{ id: string }[]>`
    UPDATE tasks
    SET status = 'completed',
        result = ${JSON.stringify(result ?? {})}::jsonb,
        completed_by = ${actor.id}::uuid,
        completed_at = now(),
        updated_at = now()
    WHERE id = ${taskId}::uuid AND status IN ('open', 'in_progress')
    RETURNING id
  `;
  if (closed.length === 0) {
    return { ok: false, status: 409, error: 'Task is already closed', code: 'TASK_CLOSED' };
  }

  // Resume the parked instance via the shared paused→retrying core. Auth is
  // re-checked there against the INSTANCE's tenant (defense in depth).
  let resumed = false;
  if (task.processInstanceId) {
    const adv = await forceAdvanceProcess({
      instanceId: task.processInstanceId,
      actor,
      note: `task ${taskId} completed`,
    });
    resumed = adv.ok;
    // If the instance couldn't be resumed (e.g. already moved on), the task is
    // still legitimately completed — report success but reflect resumed=false.
  }

  return { ok: true, data: { taskId, resumed } };
}
