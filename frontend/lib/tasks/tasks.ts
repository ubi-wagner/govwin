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
import { sql, sqlBypass } from '@/lib/db';
import { runInBypass } from '@/lib/tenant-context';
import { forceAdvanceProcess } from '@/lib/process/force-advance';
import { hasRoleAtLeast, isRole, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor, systemActor } from '@/lib/events';

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
  /** For a broadcast: result.chain[] is the message thread (typed, timestamped entries). */
  result: Record<string, unknown> | null;
  createdAt: string;
  /** Claim (mig 249). `claimedByName` is joined from `users`, which carries no RLS — a claim that
   *  could not name its holder would render "Someone is on this" and lose the feature's whole
   *  point, which is telling a reader WHO is already doing it. */
  claimedBy: string | null;
  claimedAt: string | null;
  claimedByName: string | null;
  resumeHref: string | null;
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
          SELECT t.id, t.tenant_id, t.assignee_role, t.assignee_user_id, t.task_type, t.title,
                 t.description, t.entity_type, t.entity_id, t.process_instance_id, t.step_name,
                 t.status, t.due_at, t.nudge_schedule, t.params, t.result, t.created_at,
                 t.claimed_by, t.claimed_at, t.resume_href,
                 COALESCE(cu.name, cu.email) AS claimed_by_name
          FROM tasks t
          LEFT JOIN users cu ON cu.id = t.claimed_by
          WHERE t.status IN ('open', 'in_progress')
            AND (
              (t.assignee_role IN ('rfp_admin', 'master_admin') AND (t.tenant_id IS NULL OR t.tenant_id = ${tenantId}::uuid))
              OR (t.assignee_role IN ('tenant_admin', 'tenant_user', 'partner_user') AND t.tenant_id = ${tenantId}::uuid)
              OR t.assignee_user_id = ${userId}::uuid
              -- A descended shadow admin RECEIVES this tenant's broadcasts as though they were its admin
              -- (thread stays visible; single-ack drops once they post). Bounded to the descended tenant.
              OR (t.tenant_id = ${tenantId}::uuid AND t.assignee_role IS NULL AND t.assignee_user_id IS NULL
                  AND (t.params->>'kind' = 'thread'
                       OR NOT (COALESCE(t.result->'chain', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('by', ${userId}::text)))))
            )
          ORDER BY t.due_at ASC NULLS LAST, t.created_at ASC
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
        SELECT t.id, t.tenant_id, t.assignee_role, t.assignee_user_id, t.task_type, t.title,
               t.description, t.entity_type, t.entity_id, t.process_instance_id, t.step_name,
               t.status, t.due_at, t.nudge_schedule, t.params, t.result, t.created_at,
               t.claimed_by, t.claimed_at, t.resume_href,
               COALESCE(cu.name, cu.email) AS claimed_by_name
        FROM tasks t
        LEFT JOIN users cu ON cu.id = t.claimed_by
        WHERE t.status IN ('open', 'in_progress')
          AND (t.assignee_role IN ('rfp_admin', 'master_admin') OR t.assignee_user_id = ${userId}::uuid)
        ORDER BY t.due_at ASC NULLS LAST, t.created_at ASC
        LIMIT 200
      `;
    } catch (e) {
      console.error('[tasks] listOpenTasksForActor admin query failed:', e);
      throw new Error('Failed to load tasks');
    }
  }

  // Tenant users are pinned to their own tenant, seeing their role bucket AND below (hierarchical),
  // PLUS every tenant BROADCAST (assignee_role + assignee_user_id both NULL): a THREAD
  // (params.kind='thread') stays visible to all so the conversation persists; a single-ack broadcast
  // drops from THIS actor's queue once they've posted to result.chain (no clearing for anyone else).
  try {
    return await sql<TaskRow[]>`
      SELECT t.id, t.tenant_id, t.assignee_role, t.assignee_user_id, t.task_type, t.title,
             t.description, t.entity_type, t.entity_id, t.process_instance_id, t.step_name,
             t.status, t.due_at, t.nudge_schedule, t.params, t.result, t.created_at,
             t.claimed_by, t.claimed_at, t.resume_href,
             COALESCE(cu.name, cu.email) AS claimed_by_name
      FROM tasks t
      LEFT JOIN users cu ON cu.id = t.claimed_by
      WHERE t.status IN ('open', 'in_progress')
        AND t.tenant_id = ${tenantId}::uuid
        AND (
          t.assignee_role = ANY(${visibleTenantRoles})
          OR t.assignee_user_id = ${userId}::uuid
          OR (t.assignee_role IS NULL AND t.assignee_user_id IS NULL
              AND (t.params->>'kind' = 'thread'
                   OR NOT (COALESCE(t.result->'chain', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('by', ${userId}::text)))))
        )
      ORDER BY t.due_at ASC NULLS LAST, t.created_at ASC
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
    SELECT t.id, t.tenant_id, t.assignee_role, t.assignee_user_id, t.task_type, t.title,
           t.description, t.entity_type, t.entity_id, t.process_instance_id, t.step_name,
           t.status, t.due_at, t.nudge_schedule, t.params, t.result, t.created_at,
           t.claimed_by, t.claimed_at, t.resume_href,
           COALESCE(cu.name, cu.email) AS claimed_by_name
    FROM tasks t
    LEFT JOIN users cu ON cu.id = t.claimed_by
    WHERE t.status IN ('open', 'in_progress')
      AND t.assignee_role IN ('rfp_admin', 'master_admin')
      AND (t.tenant_id IS NULL OR t.task_type = 'proposal_setup')
      -- A ToDo whose SOLICITATION is gone is not a task an operator can do. completers.ts deep-
      -- links entity_type 'solicitation' at /admin/rfp-curation/<id>, so such a row is a 404 in the
      -- one list that is supposed to be their next actions -- customer-finish grades it a
      -- brokenLink, and it is the same finding as the amendments queue one table over.
      --
      -- Filtered where the list is BUILT, not by chasing every path that could delete a
      -- solicitation: nothing deletes one in production, harnesses do, and either way the queue
      -- must not offer work that cannot be performed. Only 'solicitation' is checked -- every other
      -- entity type is left exactly as it was.
      AND (t.entity_type IS DISTINCT FROM 'solicitation'
           OR t.entity_id IS NULL
           OR EXISTS (SELECT 1 FROM curated_solicitations cs WHERE cs.id = t.entity_id))
    ORDER BY t.due_at ASC NULLS LAST, t.created_at ASC
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
  /** A tenant-wide broadcast: no named assignee, visible to EVERY member of the tenant (and to a
   *  descended shadow admin / partner-manager, treated as the tenant's admin). Each viewer
   *  acknowledges independently (per-user receipt), so one ack never clears it for the others. */
  broadcast?: boolean;
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
  const broadcast = opts.broadcast === true;
  // A broadcast has NO named assignee (both null); a normal task keeps its role/user target.
  const assigneeRole = broadcast ? null : (opts.assigneeRole?.trim() || null);
  const assigneeUserId = broadcast ? null : (opts.assigneeUserId?.trim() || null);

  // ── invariants ──
  if (!taskType) return { ok: false, status: 400, error: 'taskType is required', code: 'VALIDATION_ERROR' };
  if (!title) return { ok: false, status: 400, error: 'title is required', code: 'VALIDATION_ERROR' };
  // A broadcast is tenant-wide (all members) — it needs a tenant to scope to, and no named assignee.
  // Every other task must name a role bucket or a user. (There is NO global/admin broadcast: a
  // null-tenant task with no assignee would target every admin — disallowed.)
  if (broadcast) {
    if (!tenantId) return { ok: false, status: 400, error: 'a broadcast requires a tenant', code: 'VALIDATION_ERROR' };
  } else if (!assigneeRole && !assigneeUserId) {
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
      // Accept the assignee if they are an active member of this tenant by the CANONICAL membership
      // model (user_memberships, RLS-off) — the same basis verifyTenantAccess uses — which covers
      // cross-company COLLABORATORS (partner_user) whose home users.tenant_id is their OWN company.
      // The legacy users.tenant_id match stays as belt-and-suspenders for normal tenant members.
      // Without the membership branch a section ToDo could never be assigned to the partner_user
      // actually granted edit on that section (SPINE-T1).
      member = await sql<{ id: string }[]>`
        SELECT u.id FROM users u
        WHERE u.id = ${assigneeUserId}::uuid AND u.is_active = true
          AND (
            u.tenant_id IS NOT DISTINCT FROM ${tenantId}::uuid
            OR EXISTS (
              SELECT 1 FROM user_memberships m
              WHERE m.user_id = u.id AND m.tenant_id = ${tenantId}::uuid AND m.status = 'active'
            )
          )
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
    params: Record<string, unknown> | null;
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
      params: Record<string, unknown> | null;
    }[]>`
      SELECT id, status, tenant_id, assignee_role, assignee_user_id, process_instance_id, task_type, params
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

  // ── Broadcast (tenant-wide, no named assignee) → append to the message CHAIN. ──
  // A broadcast is ONE row visible to the whole tenant (and to a descended shadow admin / partner-
  // manager, whom the cross-tenant guard above already admits). It never closes on a response — each
  // response is appended to result.chain[] as a TYPED, server-timestamped entry (atomically, in one
  // UPDATE, so no read-modify-write race), turning the broadcast into a lightweight message thread
  // (ala a group chat). Entry shape (extensible — future workflows append their own `type`s, e.g. a
  // proposed meeting time or a task): { by, name, at, type: 'ack'|'message', text, disposition }.
  //   • A THREAD (params.kind='thread') accepts REPEATED posts — a real back-and-forth — and stays in
  //     everyone's view (see listOpenTasksForActor); nobody is required to respond.
  //   • A plain ack/read-receipt broadcast is SINGLE-post (the guard blocks a second entry) and drops
  //     from a responder's queue once they've posted.
  // No role/user assignee check (a broadcast is for everyone), no parked instance to resume, no trigger.
  const isBroadcast = !task.assigneeRole && !task.assigneeUserId && task.tenantId != null;
  if (isBroadcast) {
    const rb = (result ?? {}) as Record<string, unknown>;
    const memoText = typeof rb.memo === 'string' && rb.memo.trim() ? rb.memo.trim().slice(0, 4000) : null;
    const disposition = typeof rb.disposition === 'string' ? rb.disposition : (rb.read === true ? 'read' : null);
    const entryType = memoText ? 'message' : 'ack';
    const name = actor.email ?? actor.id;
    const isThread = (task.params as { kind?: unknown } | null)?.kind === 'thread';
    try {
      if (isThread) {
        // A thread accepts repeated posts — always append (a real conversation).
        await sql`
          UPDATE tasks
          SET result = jsonb_set(COALESCE(result, '{}'::jsonb), '{chain}',
                COALESCE(t.result->'chain', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                  'by', ${actor.id}::text, 'name', ${name}::text, 'at', now(),
                  'type', ${entryType}::text, 'text', ${memoText}::text, 'disposition', ${disposition}::text))),
              updated_at = now()
          WHERE id = ${taskId}::uuid AND status IN ('open', 'in_progress')
        `;
      } else {
        // A single-ack broadcast: append only if this actor has not already responded (idempotent).
        await sql`
          UPDATE tasks
          SET result = jsonb_set(COALESCE(result, '{}'::jsonb), '{chain}',
                COALESCE(t.result->'chain', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                  'by', ${actor.id}::text, 'name', ${name}::text, 'at', now(),
                  'type', ${entryType}::text, 'text', ${memoText}::text, 'disposition', ${disposition}::text))),
              updated_at = now()
          WHERE id = ${taskId}::uuid AND status IN ('open', 'in_progress')
            AND NOT (COALESCE(t.result->'chain', '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('by', ${actor.id}::text)))
        `;
      }
    } catch (e) {
      console.error('[tasks] completeTask broadcast chain-append failed:', e);
      return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
    }
    await emitEventSingle({
      namespace: 'proposal', type: 'task.completed',
      actor: userActor(actor.id, actor.email ?? undefined),
      tenantId: task.tenantId,
      payload: { taskId, taskType: task.taskType, resumed: false, completedBy: actor.id, broadcast: true, thread: isThread, disposition },
    });
    return { ok: true, data: { taskId, resumed: false } };
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

/**
 * Close every open ToDo attached to an entity, because the thing it asked about has been decided.
 *
 * A ToDo is a question posed to a human. Once the question is answered — the application accepted,
 * the solicitation dismissed — the ToDo is not "done later", it is *moot*, and leaving it open
 * makes the queue a liar: an operator opens their inbox to work that no longer exists, and the
 * list grows monotonically for as long as the product runs (bug log B51 — three applications, all
 * accepted, six open ToDos still asking someone to review them).
 *
 * Deciding is therefore the moment to close, and the decision routes own that. This helper exists
 * so accept and reject cannot drift apart, and so the closing runs through `completeTask` — which
 * keeps the audit event, the workflow resume and the broadcast semantics identical to a human
 * pressing the button.
 *
 * BEST-EFFORT BY CONTRACT. A ToDo that fails to close must never fail the decision it follows:
 * the application really was accepted, and a stale row is a smaller problem than a 500 on a
 * customer's onboarding. Failures are counted and returned so the caller can log them.
 *
 * ADMIN-ONLY, AND IT RUNS UNDER BYPASS — both halves of that are load-bearing.
 *
 * The rows this closes are PLATFORM-scope (`tenant_id IS NULL`, CLAUDE.md). Since mig 185 split
 * the coarse FOR ALL policy on `tasks` into per-command policies, UPDATE is `own only`:
 *
 *     USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
 *
 * and NULL never equals anything, so a platform ToDo is READABLE but NOT UPDATABLE through the
 * context-aware `sql` under the NOBYPASSRLS `govtech_app` role. Verified live against the
 * enforced sandbox: SELECT returns the row, the paired UPDATE returns 0 rows. `completeTask`
 * would then see `closed.length === 0` and report `TASK_CLOSED` — a *silent no-op that looks like
 * success*, which is the exact failure B51 is about, only one layer deeper and harder to see.
 * `/api/admin/tasks` already handles this by calling `enterBypass()` before `completeTask`;
 * `runInBypass` is the scoped form, so this helper is correct no matter what its caller entered.
 *
 * Bypass disables the RLS layer, so the role gate below is what keeps that from being an
 * escalation: only an rfp_admin+ decision route may close another party's ToDos this way.
 * `completeTask` still applies its own assignee + tenant belts to every row.
 */
export async function closeTasksForEntity(opts: {
  entityType: string;
  entityId: string;
  actor: { id: string; email: string | null; role: Role; tenantId: string | null };
  /** Recorded on each task as the reason it closed — shows in the audit trail. */
  result?: Record<string, unknown>;
}): Promise<{ closed: number; alreadyClosed: number; failed: number }> {
  const { entityType, entityId, actor, result } = opts;
  const out = { closed: 0, alreadyClosed: 0, failed: 0 };
  if (!entityType || !entityId) return out;
  if (!hasRoleAtLeast(actor.role, 'rfp_admin')) {
    console.error('[tasks/closeTasksForEntity] refused — admin role required', actor.role);
    return { ...out, failed: 1 };
  }

  let open: { id: string }[];
  try {
    open = await sqlBypass<{ id: string }[]>`
      SELECT id FROM tasks
      WHERE entity_type = ${entityType} AND entity_id = ${entityId}::uuid
        AND status IN ('open', 'in_progress')
    `;
  } catch (e) {
    console.error('[tasks/closeTasksForEntity] lookup failed', entityType, entityId, e);
    return { ...out, failed: 1 };
  }

  for (const t of open) {
    try {
      const r = await runInBypass(() => completeTask({ taskId: t.id, actor, result }));
      if (r.ok) out.closed += 1;
      else if (r.code === 'TASK_CLOSED') out.alreadyClosed += 1;
      else { out.failed += 1; console.error('[tasks/closeTasksForEntity] complete refused', t.id, r.code); }
    } catch (e) {
      out.failed += 1;
      console.error('[tasks/closeTasksForEntity] complete threw', t.id, e);
    }
  }
  return out;
}

/**
 * ══ CLAIMS ═══════════════════════════════════════════════════════════════════════════════════
 *
 * `tasks.status` has permitted 'in_progress' since the table existed and NOTHING ever wrote it
 * (measured: open 47 · completed 65 · expired 2 · in_progress 0). So a ToDo was binary, and the
 * queue could not tell an item somebody had begun from one nobody had touched.
 *
 * That gap costs most exactly where P1 and P2 now bite: a session that ends ON TIME strands more
 * in-flight work than one that never ends. A claim is the record that work started, and
 * `resume_href` is what makes coming back cheap instead of starting over.
 *
 * A CLAIM IS NOT A LOCK. It cannot block anyone — `completeTask` is unchanged and still accepts any
 * authorised assignee. It expires on a sweep rather than waiting to be released. The thing being
 * protected is attention, not correctness: two people drafting one section is waste, two people
 * blocked on a stuck lock is an outage.
 */

/** How long a claim survives without being renewed. Deliberately longer than the descent window
 *  (30m) and shorter than the shortest session idle window (2h): a claim should outlive a coffee
 *  break and never outlive the session that took it. */
export const CLAIM_STALE_MINUTES = 90;

export interface ClaimResult {
  ok: boolean;
  status: number;
  error?: string;
  code?: string;
  data?: { taskId: string; claimedBy: string | null; resumeHref: string | null };
}

/**
 * Take a claim on a ToDo.
 *
 * The authority predicate is COPIED FROM `completeTask` rather than re-derived: same cross-tenant
 * guard, same hierarchical role match, same named-user match. A claim that a wider set of people
 * could take than could complete would let someone park an item they cannot finish.
 *
 * Compare-and-swap on `status = 'open'`, so a second claimant loses cleanly rather than overwriting
 * the first. `AND (claimed_by IS NULL OR claimed_by = actor)` lets the holder re-claim to RENEW,
 * which is what keeps a long piece of work from being swept out from under someone.
 */
export async function claimTask(opts: {
  taskId: string;
  actor: { id: string; email: string | null; role: Role; tenantId: string | null };
}): Promise<ClaimResult> {
  const { taskId, actor } = opts;
  let task: {
    id: string; status: string; tenantId: string | null; assigneeRole: string | null;
    assigneeUserId: string | null; claimedBy: string | null; resumeHref: string | null;
  } | undefined;
  try {
    [task] = await sql<{
      id: string; status: string; tenantId: string | null; assigneeRole: string | null;
      assigneeUserId: string | null; claimedBy: string | null; resumeHref: string | null;
    }[]>`
      SELECT id, status, tenant_id, assignee_role, assignee_user_id,
             claimed_by AS "claimedBy", resume_href AS "resumeHref"
        FROM tasks WHERE id = ${taskId}::uuid`;
  } catch (e) {
    console.error('[tasks] claimTask lookup failed:', e);
    return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
  }
  if (!task) return { ok: false, status: 404, error: 'Task not found', code: 'NOT_FOUND' };
  if (task.status === 'completed' || task.status === 'cancelled' || task.status === 'expired') {
    return { ok: false, status: 409, error: `Task is already ${task.status}`, code: 'TASK_CLOSED' };
  }

  const isAdmin = hasRoleAtLeast(actor.role, 'rfp_admin');
  if (!isAdmin && task.tenantId !== actor.tenantId) {
    return { ok: false, status: 403, error: 'Not an assignee of this task', code: 'FORBIDDEN' };
  }
  const roleAssignee =
    !!task.assigneeRole && isRole(task.assigneeRole) && hasRoleAtLeast(actor.role, task.assigneeRole);
  const userAssignee = !!task.assigneeUserId && task.assigneeUserId === actor.id;
  if (!roleAssignee && !userAssignee) {
    return { ok: false, status: 403, error: 'Not an assignee of this task', code: 'FORBIDDEN' };
  }

  // Somebody else already holds it. 409 with WHO, because "someone is on this" is the entire value
  // of the feature — a refusal that does not name the holder just looks like a broken button.
  if (task.claimedBy && task.claimedBy !== actor.id) {
    let holder = 'someone else';
    try {
      const [u] = await runInBypass(async () => sql<{ email: string | null; name: string | null }[]>`
        SELECT email, name FROM users WHERE id = ${task.claimedBy}::uuid`);
      holder = u?.name || u?.email || holder;
    } catch { /* the name is a courtesy; the refusal stands without it */ }
    return {
      ok: false, status: 409, code: 'ALREADY_CLAIMED',
      error: `${holder} is already working on this.`,
    };
  }

  try {
    const rows = await sql<{ id: string; resumeHref: string | null }[]>`
      UPDATE tasks
         SET status = 'in_progress', claimed_by = ${actor.id}::uuid, claimed_at = now(),
             updated_at = now()
       WHERE id = ${taskId}::uuid
         AND status IN ('open', 'in_progress')
         AND (claimed_by IS NULL OR claimed_by = ${actor.id}::uuid)
       RETURNING id, resume_href AS "resumeHref"`;
    if (rows.length === 0) {
      // The CAS lost — somebody claimed or closed it between the read and the write.
      return { ok: false, status: 409, error: 'Someone else just took this.', code: 'ALREADY_CLAIMED' };
    }
    await emitEventSingle({
      type: 'task.claimed',
      namespace: 'system',
      tenantId: task.tenantId,
      actor: userActor(actor.id, actor.email ?? undefined),
      payload: { taskId, entityType: 'task', entityId: taskId },
    }).catch(() => {});
    return { ok: true, status: 200, data: { taskId, claimedBy: actor.id, resumeHref: rows[0].resumeHref } };
  } catch (e) {
    console.error('[tasks] claimTask failed:', e);
    return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
  }
}

/**
 * Put a claimed ToDo back. Only the holder, or an admin unsticking a queue.
 *
 * Back to 'open' rather than to nothing: the task returns to the queue exactly as it arrived, which
 * is the state every other reader already understands.
 */
export async function releaseTask(opts: {
  taskId: string;
  actor: { id: string; email: string | null; role: Role; tenantId: string | null };
}): Promise<ClaimResult> {
  const { taskId, actor } = opts;
  const isAdmin = hasRoleAtLeast(actor.role, 'rfp_admin');
  try {
    const rows = await sql<{ id: string; tenantId: string | null }[]>`
      UPDATE tasks
         SET status = 'open', claimed_by = NULL, claimed_at = NULL, updated_at = now()
       WHERE id = ${taskId}::uuid
         AND status = 'in_progress'
         AND (${isAdmin} OR claimed_by = ${actor.id}::uuid)
       RETURNING id, tenant_id AS "tenantId"`;
    if (rows.length === 0) {
      return { ok: false, status: 409, error: 'Not claimed by you, or not in progress.', code: 'NOT_CLAIMED' };
    }
    await emitEventSingle({
      type: 'task.released',
      namespace: 'system',
      tenantId: rows[0].tenantId,
      actor: userActor(actor.id, actor.email ?? undefined),
      payload: { taskId, entityType: 'task', entityId: taskId },
    }).catch(() => {});
    return { ok: true, status: 200, data: { taskId, claimedBy: actor.id, resumeHref: null } };
  } catch (e) {
    console.error('[tasks] releaseTask failed:', e);
    return { ok: false, status: 500, error: 'Internal error', code: 'DB_ERROR' };
  }
}

/**
 * Return abandoned claims to the queue.
 *
 * This is the half that makes a claim safe to take. Without it, a person signed out mid-task —
 * which P1 and P2 now guarantee happens — leaves the queue asserting indefinitely that somebody is
 * working on something they were ejected from, and nobody else will pick it up.
 *
 * Emits per row rather than one summary event: "which ToDo went back" is the question anyone asks
 * afterwards, and a count cannot answer it.
 */
export async function sweepStaleClaims(staleMinutes = CLAIM_STALE_MINUTES): Promise<number> {
  try {
    const rows = await runInBypass(async () => sql<{
      id: string; tenantId: string | null; claimedBy: string; title: string;
    }[]>`
      UPDATE tasks
         SET status = 'open', claimed_by = NULL, claimed_at = NULL, updated_at = now()
       WHERE status = 'in_progress'
         AND claimed_at IS NOT NULL
         AND claimed_at < now() - make_interval(mins => ${staleMinutes})
       RETURNING id, tenant_id AS "tenantId", claimed_by AS "claimedBy", title`);
    for (const r of rows) {
      await emitEventSingle({
        type: 'task.claim_expired',
        namespace: 'system',
        tenantId: r.tenantId,
        actor: systemActor('claim-sweep'),
        payload: { taskId: r.id, entityType: 'task', entityId: r.id, title: r.title, staleMinutes },
      }).catch(() => {});
    }
    return rows.length;
  } catch (e) {
    console.error('[tasks] sweepStaleClaims failed:', e);
    return 0;
  }
}
