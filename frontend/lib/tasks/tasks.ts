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
import { hasRoleAtLeast, isRole, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

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

  // The tenant-role bucket an actor can see is HIERARCHICAL: a task assigned to role R is visible to
  // anyone who can perform R's job (their role is at-or-above R). So a tenant_admin sees tenant_user
  // ToDos; a tenant_user does not see tenant_admin ToDos. (Was exact-match — HITL G3.)
  const TENANT_ROLES = ['tenant_admin', 'tenant_user', 'partner_user'] as const;
  const visibleTenantRoles = TENANT_ROLES.filter((r) => hasRoleAtLeast(role, r)) as unknown as string[];

  // NOTE: postgres.js treats ${} as a PARAM binding, not code — branch scope in JS, never with a
  // ternary inside the tagged template. Columns are inlined per branch (house style; no fragment comp).
  if (isAdmin) {
    // Admin DESCENDED into a specific tenant (shadow-admin) — they are tenant_admin by derived
    // membership, so they see + can act on that tenant's ToDos too. BOUNDED to this one tenant
    // (no cross-tenant widening): admin-bucket (null-tenant or this tenant) + this tenant's
    // tenant_admin/tenant_user/partner_user ToDos + anything named to them. (HITL G2.)
    if (tenantId) {
      try {
        return await sql<TaskRow[]>`
          SELECT id, tenant_id, assignee_role, assignee_user_id, task_type, title,
                 description, entity_type, entity_id, process_instance_id, step_name,
                 status, due_at, nudge_schedule, params, created_at
          FROM tasks
          WHERE status IN ('open', 'in_progress')
            AND (
              (assignee_role IN ('rfp_admin', 'master_admin') AND (tenant_id IS NULL OR tenant_id = ${tenantId}::uuid))
              OR (assignee_role IN ('tenant_admin', 'tenant_user', 'partner_user') AND tenant_id = ${tenantId}::uuid)
              OR assignee_user_id = ${userId}::uuid
            )
          ORDER BY due_at ASC NULLS LAST, created_at ASC
          LIMIT 200
        `;
      } catch (e) {
        console.error('[tasks] listOpenTasksForActor shadow-admin query failed:', e);
        throw new Error('Failed to load tasks');
      }
    }
    // Admin dashboard (no tenant in context) — admin-bucket across all tenants + own-id tasks.
    try {
      return await sql<TaskRow[]>`
        SELECT id, tenant_id, assignee_role, assignee_user_id, task_type, title,
               description, entity_type, entity_id, process_instance_id, step_name,
               status, due_at, nudge_schedule, params, created_at
        FROM tasks
        WHERE status IN ('open', 'in_progress')
          AND (assignee_role IN ('rfp_admin', 'master_admin') OR assignee_user_id = ${userId}::uuid)
        ORDER BY due_at ASC NULLS LAST, created_at ASC
        LIMIT 200
      `;
    } catch (e) {
      console.error('[tasks] listOpenTasksForActor admin query failed:', e);
      throw new Error('Failed to load tasks');
    }
  }

  // Tenant users are pinned to their own tenant, seeing their role bucket AND below (hierarchical).
  try {
    return await sql<TaskRow[]>`
      SELECT id, tenant_id, assignee_role, assignee_user_id, task_type, title,
             description, entity_type, entity_id, process_instance_id, step_name,
             status, due_at, nudge_schedule, params, created_at
      FROM tasks
      WHERE status IN ('open', 'in_progress')
        AND (assignee_role = ANY(${visibleTenantRoles}) OR assignee_user_id = ${userId}::uuid)
        AND tenant_id = ${tenantId}::uuid
      ORDER BY due_at ASC NULLS LAST, created_at ASC
      LIMIT 200
    `;
  } catch (e) {
    console.error('[tasks] listOpenTasksForActor tenant query failed:', e);
    throw new Error('Failed to load tasks');
  }
}

/**
 * The shared ADMIN triage queue — open tasks targeting EITHER admin role bucket
 * (`rfp_admin` or `master_admin`), regardless of which admin is viewing. Unlike
 * `listOpenTasksForActor` (role-exact, per-actor), this is the queue surface for
 * the curation dashboard: a master_admin must see the rfp_admin triage ToDos that
 * the detection workflow parks (C2.b), not just tasks for their own role.
 *
 * Admin-scoped by default (tenant_id IS NULL), mirroring the events convention —
 * PLUS the tenant-scoped `proposal_setup` gate (a customer purchase that needs expert
 * curation + release; it must carry the buyer's tenant/opp, so it can't be null-tenant).
 * Soonest due first, then oldest — the natural urgency order. Read-only; completion
 * stays with completeTask.
 */
export async function listOpenAdminTriageTasks(limit = 50): Promise<TaskRow[]> {
  return await sql<TaskRow[]>`
    SELECT id, tenant_id, assignee_role, assignee_user_id, task_type, title,
           description, entity_type, entity_id, process_instance_id, step_name,
           status, due_at, nudge_schedule, params, created_at
    FROM tasks
    WHERE status IN ('open', 'in_progress')
      AND assignee_role IN ('rfp_admin', 'master_admin')
      AND (tenant_id IS NULL OR task_type = 'proposal_setup')
    ORDER BY due_at ASC NULLS LAST, created_at ASC
    LIMIT ${limit}
  `;
}

export type CreateTaskResult =
  | { ok: true; data: { taskId: string } }
  | { ok: false; status: number; error: string; code: string };

/**
 * Human task delegation (J1) — assign a contributor a job. The counterpart to the
 * engine's _create_task: same `tasks` ledger, but `process_instance_id` is NULL
 * (no parked workflow), so completeTask closes it without a resume. Surfaces in
 * the assignee's queue + gets nudged by the same sweep. Emits proposal:task.assigned.
 *
 * Authorization is the caller's job (route: tenant_user+). This core enforces the
 * data invariants: an assignee (role bucket and/or a specific user), and — when a
 * specific user is named — that the user is active and in the TASK's tenant
 * (no cross-tenant assignment). Admin tasks (tenantId=null) assign to admin users.
 */
export async function createTask(opts: {
  actor: { id: string; email: string | null; role: Role; tenantId: string | null };
  tenantId: string | null;
  assigneeRole?: string | null;
  assigneeUserId?: string | null;
  taskType: string;
  title: string;
  description?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  dueAt?: string | null;
  nudgeDays?: number[];
  params?: Record<string, unknown>;
}): Promise<CreateTaskResult> {
  const { actor, tenantId } = opts;
  const taskType = opts.taskType?.trim();
  const title = opts.title?.trim();
  const assigneeRole = opts.assigneeRole?.trim() || null;
  const assigneeUserId = opts.assigneeUserId?.trim() || null;

  // ── invariants ──
  if (!taskType) return { ok: false, status: 400, error: 'taskType is required', code: 'VALIDATION_ERROR' };
  if (!title) return { ok: false, status: 400, error: 'title is required', code: 'VALIDATION_ERROR' };
  if (!assigneeRole && !assigneeUserId) {
    return { ok: false, status: 400, error: 'an assignee role or user is required', code: 'VALIDATION_ERROR' };
  }
  if (assigneeRole && !isRole(assigneeRole)) {
    return { ok: false, status: 400, error: 'invalid assignee role', code: 'VALIDATION_ERROR' };
  }
  let dueAtIso: string | null = null;
  if (opts.dueAt) {
    const d = new Date(opts.dueAt);
    if (isNaN(d.getTime())) return { ok: false, status: 400, error: 'invalid dueAt', code: 'VALIDATION_ERROR' };
    dueAtIso = d.toISOString();
  }
  const nudgeDays = Array.isArray(opts.nudgeDays)
    ? opts.nudgeDays.filter((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
    : [];
  // A declared nudge cadence only fires when the task has a due_at (the pipeline sweep skips
  // due_at IS NULL, and the in-app queue's urgency is a no-op without it). If nudgeDays were given
  // WITHOUT an explicit dueAt, derive one from the last nudge day so the cadence is actually live.
  if (!dueAtIso && nudgeDays.length > 0) {
    dueAtIso = new Date(Date.now() + Math.max(...nudgeDays) * 86_400_000).toISOString();
  }

  // ── same-tenant assignee guard (a named user must belong to the task tenant) ──
  if (assigneeUserId) {
    let member: { id: string }[];
    try {
      member = await sql<{ id: string }[]>`
        SELECT id FROM users
        WHERE id = ${assigneeUserId}::uuid
          AND is_active = true
          AND tenant_id IS NOT DISTINCT FROM ${tenantId}::uuid
      `;
    } catch (e) {
      console.error('[tasks] createTask assignee lookup failed:', e);
      return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
    }
    if (member.length === 0) {
      return { ok: false, status: 400, error: 'assignee is not an active member of this tenant', code: 'VALIDATION_ERROR' };
    }
  }

  // ── insert (process_instance_id / step_name stay NULL — a human task) ──
  let inserted: { id: string }[];
  try {
    inserted = await sql<{ id: string }[]>`
      INSERT INTO tasks (
        tenant_id, assignee_role, assignee_user_id, task_type, title, description,
        entity_type, entity_id, status, due_at, nudge_schedule, params
      ) VALUES (
        ${tenantId}::uuid, ${assigneeRole}, ${assigneeUserId}::uuid, ${taskType}, ${title},
        ${opts.description?.trim() || null}, ${opts.entityType?.trim() || null},
        ${opts.entityId?.trim() || null}::uuid, 'open', ${dueAtIso}::timestamptz,
        ${sql.json(nudgeDays)}, ${sql.json((opts.params ?? {}) as Parameters<typeof sql.json>[0])}
      )
      RETURNING id
    `;
  } catch (e) {
    console.error('[tasks] createTask insert failed:', e);
    return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
  }
  const taskId = inserted[0].id;

  // ── emit proposal:task.assigned (best-effort) ──
  await emitEventSingle({
    namespace: 'proposal',
    type: 'task.assigned',
    actor: userActor(actor.id, actor.email ?? undefined),
    tenantId,
    payload: {
      taskId, taskType, title, assigneeRole, assigneeUserId,
      entityType: opts.entityType?.trim() || null,
      entityId: opts.entityId?.trim() || null,
      assignedBy: actor.id,
      dueAt: dueAtIso,
    },
  });

  return { ok: true, data: { taskId } };
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

  let rows: {
    id: string;
    status: string;
    tenantId: string | null;
    assigneeRole: string | null;
    assigneeUserId: string | null;
    processInstanceId: string | null;
    taskType: string;
  }[];
  try {
    rows = await sql<{
      id: string;
      status: string;
      tenantId: string | null;
      assigneeRole: string | null;
      assigneeUserId: string | null;
      processInstanceId: string | null;
      taskType: string;
    }[]>`
      SELECT id, status, tenant_id, assignee_role, assignee_user_id, process_instance_id, task_type
      FROM tasks WHERE id = ${taskId}::uuid
    `;
  } catch (e) {
    console.error('[tasks] completeTask lookup failed:', e);
    return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
  }
  if (rows.length === 0) {
    return { ok: false, status: 404, error: 'Task not found', code: 'NOT_FOUND' };
  }
  const task = rows[0];
  if (task.status !== 'open' && task.status !== 'in_progress') {
    return { ok: false, status: 409, error: `Task is already ${task.status}`, code: 'TASK_CLOSED' };
  }

  // Cross-tenant guard (RLS-audit leak #1, cross-tenant WRITE): the task was loaded by bare id and
  // the assignee-by-ROLE check below is a GLOBAL role-string match, so without this a tenant_admin
  // of tenant A could close (and stamp a forged result / completed_by on) a same-role task in
  // tenant B. A tenant actor may complete ONLY a task in their OWN tenant; admins (rfp_admin+) keep
  // the cross-tenant / admin-task (tenant_id NULL) god-view the docstring describes.
  const isAdmin = hasRoleAtLeast(actor.role, 'rfp_admin');
  if (!isAdmin && task.tenantId !== actor.tenantId) {
    return { ok: false, status: 403, error: 'Not an assignee of this task', code: 'FORBIDDEN' };
  }

  // Must be an assignee of this task — HIERARCHICAL: the actor's role must be AT OR ABOVE the task's
  // assignee role (a tenant_admin completes a tenant_user ToDo; a descended admin — rfp_admin ≥
  // tenant_admin — completes the tenant's ToDos), OR the task is named to them by id. The cross-tenant
  // guard above already pins a non-admin to their OWN tenant, so this never crosses a tenant boundary;
  // and a tenant_admin can never complete an rfp_admin task (hasRoleAtLeast(tenant_admin, rfp_admin) is
  // false). (HITL G2/G3.)
  const roleAssignee =
    !!task.assigneeRole && isRole(task.assigneeRole) && hasRoleAtLeast(actor.role, task.assigneeRole);
  const userAssignee = !!task.assigneeUserId && task.assigneeUserId === actor.id;
  if (!roleAssignee && !userAssignee) {
    return { ok: false, status: 403, error: 'Not an assignee of this task', code: 'FORBIDDEN' };
  }

  // Side-effect-bearing, engine-external task types must be resolved through their OWN handler, not
  // the generic completer (which only closes the row + resumes a parked workflow — granting nothing).
  // A manager_request carries no process instance; closing it here would silently DROP the
  // partner_manager grant. Route it to the company Team page's approve/decline
  // (resolveManagerRequest). See docs/PARTNER_MANAGER_DESIGN.md §4B.
  if (task.taskType === 'manager_request') {
    return { ok: false, status: 409, error: 'Approve or decline this manager request from the company Team page.', code: 'USE_MANAGER_REQUEST_FLOW' };
  }

  // Close the task (guarded against a lost race).
  let closed: { id: string }[];
  try {
    closed = await sql<{ id: string }[]>`
      UPDATE tasks
      SET status = 'completed',
          result = ${sql.json((result ?? {}) as Parameters<typeof sql.json>[0])},
          completed_by = ${actor.id}::uuid,
          completed_at = now(),
          updated_at = now()
      WHERE id = ${taskId}::uuid AND status IN ('open', 'in_progress')
        -- Defense-in-depth tenant belt: non-admins can only close their own tenant's task, even if
        -- the guard above is ever bypassed by a new caller (RLS-audit leak #1).
        AND (${isAdmin} OR tenant_id IS NOT DISTINCT FROM ${actor.tenantId}::uuid)
      RETURNING id
    `;
  } catch (e) {
    console.error('[tasks] completeTask update failed:', e);
    return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
  }
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

  // Audit the completion (the counterpart to createTask's proposal:task.assigned).
  // A plain human-delegated task otherwise closes with no event on the queue.
  // Surface the disposition (text_memo: completed/delegated/not_completed) + read receipt so future
  // automation can trigger off a ToDo's outcome, and the sender can see it in the audit stream.
  const r = (result ?? {}) as Record<string, unknown>;
  await emitEventSingle({
    namespace: 'proposal',
    type: 'task.completed',
    actor: userActor(actor.id, actor.email ?? undefined),
    tenantId: task.tenantId,
    payload: {
      taskId, taskType: task.taskType, resumed, completedBy: actor.id,
      disposition: typeof r.disposition === 'string' ? r.disposition : (r.read === true ? 'read' : null),
    },
  });

  return { ok: true, data: { taskId, resumed } };
}
