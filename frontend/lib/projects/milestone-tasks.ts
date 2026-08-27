/**
 * The checklist under a milestone — and the serial dates that turn a list of them into a plan.
 *
 * ── THE CONSTRUCT ────────────────────────────────────────────────────────────────────────────
 * A milestone is a dated segment of work with an owner, a task list, and a completion record.
 * That single shape covers both cases the product needs, with nothing to switch between:
 *
 *     ONE milestone   a dated ToDo list for the team, with notifications and nudges
 *     N milestones    the same thing in series — each starting where the last one ends
 *
 * The small case is not a stripped-down mode of the large one; it IS the large one with a length
 * of one. That is what makes it extendable rather than configurable, and it is why there is no
 * `is_simple` flag anywhere in this file.
 *
 * ── SERIAL, BUT NOT RIGID ────────────────────────────────────────────────────────────────────
 * `starts_on` defaults to the previous milestone's end + 1 day, so a plan entered as four dates
 * reads as a chain. It is a DEFAULT: `pinStart` opts a milestone out, and overlap is legal, because
 * real plans overlap and a schema that forbade it would be wrong more often than it helped. The
 * database enforces only the invariant that is always true — a segment cannot end before it starts
 * (mig 218 `project_milestones_window_ordered`).
 *
 * ── MOVING A DATE MOVES WHAT FOLLOWS ─────────────────────────────────────────────────────────
 * `rescheduleMilestone(…, { cascade: true })` shifts every LATER milestone by the same delta. That
 * is the whole point of a serial plan: slipping phase 2 by three weeks slips phases 3 and 4 unless
 * someone says otherwise. It moves `starts_on`/`forecast_date` — the CURRENT plan — and never
 * `baseline_date`, which mig 216's trigger refuses to move anyway (`23001`). Variance is the
 * distance between the two, so a cascade that touched the baseline would erase the very number the
 * reschedule exists to make visible.
 *
 * ── WHY COMPLETION IS GATED ON THE LIST ──────────────────────────────────────────────────────
 * A milestone with open tasks is not met. `markMilestoneMet` already refuses on unaccepted
 * deliverables for the same reason, and the two refusals are deliberately separate messages: "the
 * work isn't finished" and "the customer hasn't accepted it" are different problems with different
 * next actions.
 */
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { canAccessProject, canAssign, type ProjectActor } from './access';
import { isoDate } from './dates';
import { raiseTaskTodo, closeTaskTodos } from './todos';
import type { Fail, Ok } from './project';

export interface MilestoneTask {
  id: string;
  projectId: string;
  milestoneId: string;
  title: string;
  detail: string | null;
  assigneeUserId: string | null;
  assigneeRole: string | null;
  assigneeEmail?: string | null;
  dueDate: string | null;
  status: 'open' | 'done' | 'blocked';
  blockedReason: string | null;
  completedAt: string | null;
  completedBy: string | null;
  sortIndex: number;
}

/** A date the database will accept, or null. Rejects rather than coercing — a silently dropped due
 *  date is worse than a refused one, because the task then looks like it has no deadline. */
function asDate(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return { ok: false };
  return Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? { ok: false } : { ok: true, value: v };
}

/** `date` + n days, as `YYYY-MM-DD`. Arithmetic in UTC — a `date` column has no zone, and doing it
 *  in local time moves the answer a day for half the world. */
export function shiftDate(value: unknown, days: number): string | null {
  const iso = isoDate(value);
  if (iso === null) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Every task on a project, newest milestone order first. Joined to `users` for the assignee's
 * email so the workspace can show a name without a second round trip.
 *
 * ⚠️ camelCase field names, matching the runtime: `lib/db.ts` applies `toCamel`, so a snake_case
 * declaration compiles and reads `undefined`. That has shipped three times in this repo.
 */
export async function listMilestoneTasks(tenantId: string, projectId: string): Promise<MilestoneTask[]> {
  try {
    return await sql<MilestoneTask[]>`
      SELECT t.id, t.project_id, t.milestone_id, t.title, t.detail,
             t.assignee_user_id, t.assignee_role, u.email AS assignee_email,
             t.due_date, t.status, t.blocked_reason, t.completed_at, t.completed_by, t.sort_index
        FROM project_milestone_tasks t
        LEFT JOIN users u ON u.id = t.assignee_user_id
       WHERE t.project_id = ${projectId}::uuid AND t.tenant_id = ${tenantId}::uuid
       ORDER BY t.sort_index, t.created_at`;
  } catch (err) {
    console.error('[projects/milestone-tasks] listMilestoneTasks failed:', err);
    return [];
  }
}

/**
 * Add a task to a milestone.
 *
 * `tenant_admin`+ — assigning work is a management act. Doing it is not: `setTaskStatus` below is
 * open to any assigned member, which is the whole reason this is a team checklist and not a
 * read-only plan.
 */
export async function createMilestoneTask(
  actor: ProjectActor,
  projectId: string,
  input: {
    milestoneId: string; title: string; detail?: string | null;
    assigneeUserId?: string | null; assigneeRole?: string | null;
    dueDate?: string | null; sortIndex?: number;
  },
): Promise<Ok<MilestoneTask> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can add tasks', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  const title = (input.title ?? '').trim();
  if (!title || title.length > 500) {
    return { ok: false, status: 400, error: 'A task title of 1–500 characters is required', code: 'VALIDATION_ERROR' };
  }
  const due = asDate(input.dueDate);
  if (!due.ok) return { ok: false, status: 400, error: 'dueDate must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  if (input.assigneeRole && !['tenant_admin', 'tenant_user'].includes(input.assigneeRole)) {
    return { ok: false, status: 400, error: 'assigneeRole must be tenant_admin or tenant_user', code: 'VALIDATION_ERROR' };
  }

  try {
    // FK-before-write, scoped to THIS project. A milestone id from another project satisfies the
    // FK perfectly and would hang one contract's task off another's phase.
    const [ms] = await sql<{ id: string }[]>`
      SELECT id FROM project_milestones
       WHERE id = ${input.milestoneId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!ms) {
      return { ok: false, status: 400, error: 'That milestone does not belong to this project', code: 'VALIDATION_ERROR' };
    }
    // Same check for the assignee: a user id from another tenant satisfies the FK to `users`.
    if (input.assigneeUserId) {
      const [member] = await sql<{ id: string }[]>`
        SELECT u.id FROM users u
          JOIN user_memberships m ON m.user_id = u.id AND m.tenant_id = ${actor.tenantId}::uuid
         WHERE u.id = ${input.assigneeUserId}::uuid AND m.status = 'active' LIMIT 1`;
      if (!member) {
        return { ok: false, status: 400, error: 'That assignee is not a member of this company', code: 'VALIDATION_ERROR' };
      }
      // ── AND THEY MUST BE ON THE PROJECT ────────────────────────────────────────────────────
      // Assignment is the access mechanism for an employee (see lib/projects/access.ts). Handing
      // work to somebody who cannot open the project is a silent dead end: the task exists, they
      // never see it, and the manager believes it is in hand. Refusing with the fix in the sentence
      // is better than granting project access as a side effect of a task form — an access decision
      // hidden inside an unrelated action is how a boundary quietly stops meaning anything.
      const [onProject] = await sql<{ userId: string }[]>`
        SELECT user_id FROM project_assignments
         WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
           AND user_id = ${input.assigneeUserId}::uuid LIMIT 1`;
      if (!onProject) {
        return {
          ok: false, status: 409, code: 'NOT_ON_PROJECT',
          error: 'That person is not on this project, so they would never see the task. '
            + 'Add them to the project first.',
        };
      }
    }

    const [row] = await sql<MilestoneTask[]>`
      INSERT INTO project_milestone_tasks
        (tenant_id, project_id, milestone_id, title, detail, assignee_user_id, assignee_role,
         due_date, sort_index, created_by)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${input.milestoneId}::uuid, ${title},
         ${input.detail ?? null}, ${input.assigneeUserId ?? null}, ${input.assigneeRole ?? null},
         ${due.value}, ${input.sortIndex ?? 0}, ${actor.userId}::uuid)
      RETURNING id, project_id, milestone_id, title, detail, assignee_user_id, assignee_role,
                due_date, status, blocked_reason, completed_at, completed_by, sort_index`;
    if (!row) return { ok: false, status: 500, error: 'Failed to add the task', code: 'DB_ERROR' };

    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.task_created',
      entityType: 'project_milestone_task', entityId: row.id,
      metadata: { projectId, milestoneId: input.milestoneId, title },
    });

    // Project the assignment onto the platform ToDo spine — the queue, the bell, the Command
    // Center and the shared nudge sweep — so a person meets project work where they meet
    // everything else. Best-effort by construction: the checklist row is already saved and correct.
    const [proj] = await sql<{ name: string }[]>`
      SELECT name FROM projects WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
    await raiseTaskTodo(actor, {
      id: row.id, projectId, milestoneId: input.milestoneId, title,
      assigneeUserId: input.assigneeUserId ?? null, assigneeRole: input.assigneeRole ?? null,
      dueDate: due.value,
    }, proj?.name ?? 'a project');

    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/milestone-tasks] createMilestoneTask failed:', err);
    return { ok: false, status: 500, error: 'Failed to add the task', code: 'DB_ERROR' };
  }
}

/**
 * Tick a task off, block it, or reopen it.
 *
 * **Any member who can reach the project may do this** — that is the point of a checklist. The
 * management acts (creating tasks, closing the milestone) stay `tenant_admin`; doing the work does
 * not, or the list becomes something a manager maintains on everyone else's behalf.
 *
 * The compare-and-swap on the current status means a double-click cannot produce two completions
 * or two events, and `completed_at` is set and cleared in the same statement as `status` so the
 * mig-218 CHECK that keeps them agreeing can never be tripped by a partial write.
 */
export async function setTaskStatus(
  actor: ProjectActor,
  projectId: string,
  taskId: string,
  next: 'open' | 'done' | 'blocked',
  blockedReason?: string | null,
): Promise<Ok<MilestoneTask> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Task not found', code: 'NOT_FOUND' };
  }
  if (!['open', 'done', 'blocked'].includes(next)) {
    return { ok: false, status: 400, error: "status must be open, done or blocked", code: 'VALIDATION_ERROR' };
  }
  const reason = (blockedReason ?? '').trim();
  if (next === 'blocked' && !reason) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'Say what is blocking it — a blocked task with no reason is a task nobody can unblock.',
    };
  }

  try {
    // ── NO SQL FRAGMENTS IN A VALUE POSITION ──────────────────────────────────────────────
    // This was `${next === 'done' ? sql`now()` : null}`. `lib/db.ts`'s Proxy intercepts the
    // tagged-template CALL, so a nested `sql`…`` inside a value is not a fragment — it is a
    // PROMISE, which postgres.js then tries to serialise as a value and throws
    // `RangeError: Invalid time value` from. The file's own header says it: fragment-composing
    // needs an explicit client. Plain JS values need nothing, so use those.
    const completedAt = next === 'done' ? new Date() : null;
    const completedBy = next === 'done' ? actor.userId : null;
    const [row] = await sql<MilestoneTask[]>`
      UPDATE project_milestone_tasks
         SET status         = ${next},
             completed_at   = ${completedAt},
             completed_by   = ${completedBy},
             blocked_reason = ${next === 'blocked' ? reason : null},
             updated_at     = now()
       WHERE id = ${taskId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid AND status <> ${next}
      RETURNING id, project_id, milestone_id, title, detail, assignee_user_id, assignee_role,
                due_date, status, blocked_reason, completed_at, completed_by, sort_index`;
    if (!row) {
      const [exists] = await sql<{ status: string }[]>`
        SELECT status FROM project_milestone_tasks
         WHERE id = ${taskId}::uuid AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
      if (!exists) return { ok: false, status: 404, error: 'Task not found', code: 'NOT_FOUND' };
      return { ok: false, status: 409, code: 'ALREADY_IN_STATE', error: `That task is already ${next}.` };
    }

    await emitEventSingle({
      namespace: 'project',
      type: next === 'done' ? 'task.completed' : next === 'blocked' ? 'task.blocked' : 'task.reopened',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, milestoneId: row.milestoneId, taskId, title: row.title, ...(next === 'blocked' ? { reason } : {}) },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: `project.task_${next}`,
      entityType: 'project_milestone_task', entityId: taskId, metadata: { projectId, title: row.title },
    });

    // The checklist is the source of truth and the ToDo follows it. Ticking the work off clears it
    // from the person's queue; blocking does NOT — a blocked task is still theirs, and hiding it
    // would make "blocked" a way to make work disappear.
    if (next === 'done') await closeTaskTodos(actor, taskId, { via: 'project checklist' });

    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/milestone-tasks] setTaskStatus failed:', err);
    return { ok: false, status: 500, error: 'Failed to update the task', code: 'DB_ERROR' };
  }
}

export interface MilestoneChainRow {
  id: string;
  title: string;
  startsOn: string | null;
  forecastDate: string | null;
  baselineDate: string | null;
  status: string;
  sortIndex: number;
}

/**
 * Fill in the serial dates: each milestone starts the day after the previous one ends.
 *
 * Only milestones whose `starts_on` is NULL are touched — a pinned start is a decision someone
 * made, and a helper that silently overwrote it would make the field useless. Returns the number
 * of rows it set, so a caller can tell "the chain was already complete" from "nothing happened".
 */
export async function resequence(
  actor: ProjectActor,
  projectId: string,
): Promise<Ok<{ filled: number }> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can reschedule', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  try {
    const rows = await sql<MilestoneChainRow[]>`
      SELECT id, title, starts_on, forecast_date, baseline_date, status, sort_index
        FROM project_milestones
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
       ORDER BY sort_index, forecast_date NULLS LAST, created_at`;

    let filled = 0;
    let prevEnd: string | null = null;
    for (const m of rows) {
      const start = isoDate(m.startsOn);
      if (start === null && prevEnd !== null) {
        const derived = shiftDate(prevEnd, 1);
        // Never derive a start that is after this milestone's own end — the CHECK would refuse it,
        // and a plan where phase 3 starts after it finishes is a data-entry error worth surfacing
        // rather than a row worth writing.
        const end = isoDate(m.forecastDate);
        if (derived && (end === null || derived <= end)) {
          await sql`
            UPDATE project_milestones SET starts_on = ${derived}::date, updated_at = now()
             WHERE id = ${m.id}::uuid AND tenant_id = ${actor.tenantId}::uuid AND starts_on IS NULL`;
          filled += 1;
        }
      }
      prevEnd = isoDate(m.forecastDate) ?? isoDate(m.startsOn) ?? prevEnd;
    }
    return { ok: true, data: { filled } };
  } catch (err) {
    console.error('[projects/milestone-tasks] resequence failed:', err);
    return { ok: false, status: 500, error: 'Failed to sequence the plan', code: 'DB_ERROR' };
  }
}

/**
 * Move a milestone's end date, and by default move everything after it by the same amount.
 *
 * This is what "serial" means in practice. Slipping phase 2 by three weeks slips phases 3 and 4 —
 * that is the plan telling the truth. `cascade: false` moves one milestone alone, for the case
 * where the slip is genuinely absorbed by slack.
 *
 * It moves the CURRENT plan only. `baseline_date` is untouched by construction: mig 216's trigger
 * would raise `23001` if this tried, and variance — the distance between the promise and the plan —
 * is the number a reschedule exists to make visible.
 */
export async function rescheduleMilestone(
  actor: ProjectActor,
  projectId: string,
  milestoneId: string,
  forecastDate: string,
  opts: { cascade?: boolean } = {},
): Promise<Ok<{ moved: number; deltaDays: number }> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can reschedule', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  const when = asDate(forecastDate);
  if (!when.ok || when.value === null) {
    return { ok: false, status: 400, error: 'forecastDate must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }

  try {
    const [target] = await sql<MilestoneChainRow[]>`
      SELECT id, title, starts_on, forecast_date, baseline_date, status, sort_index
        FROM project_milestones
       WHERE id = ${milestoneId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!target) return { ok: false, status: 404, error: 'Milestone not found', code: 'NOT_FOUND' };

    const from = isoDate(target.forecastDate);
    const deltaDays = from === null ? 0
      : Math.round((Date.parse(`${when.value}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

    // A start that is now after the end is refused HERE with a sentence, rather than reaching the
    // CHECK and coming back as a constraint name.
    const start = isoDate(target.startsOn);
    if (start !== null && when.value < start) {
      return {
        ok: false, status: 400, code: 'VALIDATION_ERROR',
        error: `That end date is before the milestone starts (${start}). Move the start first.`,
      };
    }

    await sql`
      UPDATE project_milestones SET forecast_date = ${when.value}::date, updated_at = now()
       WHERE id = ${milestoneId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
    let moved = 1;

    if (opts.cascade !== false && deltaDays !== 0) {
      // Later milestones only, and only ones still PENDING: a met milestone happened on a real
      // date and shifting it would rewrite history to keep a chart tidy.
      const later = await sql<MilestoneChainRow[]>`
        SELECT id, title, starts_on, forecast_date, baseline_date, status, sort_index
          FROM project_milestones
         WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
           AND status = 'pending' AND sort_index > ${target.sortIndex}
         ORDER BY sort_index`;
      for (const m of later) {
        const nextStart = shiftDate(m.startsOn, deltaDays);
        const nextEnd = shiftDate(m.forecastDate, deltaDays);
        if (nextStart === null && nextEnd === null) continue;
        await sql`
          UPDATE project_milestones
             SET starts_on     = COALESCE(${nextStart}::date, starts_on),
                 forecast_date = COALESCE(${nextEnd}::date, forecast_date),
                 updated_at    = now()
           WHERE id = ${m.id}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
        moved += 1;
      }
    }

    await emitEventSingle({
      namespace: 'project',
      type: 'milestone.rescheduled',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, milestoneId, title: target.title,
        from, to: when.value, deltaDays, cascaded: moved - 1,
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.milestone_rescheduled',
      entityType: 'project_milestone', entityId: milestoneId,
      metadata: { projectId, from, to: when.value, deltaDays, moved },
    });
    return { ok: true, data: { moved, deltaDays } };
  } catch (err) {
    console.error('[projects/milestone-tasks] rescheduleMilestone failed:', err);
    return { ok: false, status: 500, error: 'Failed to reschedule', code: 'DB_ERROR' };
  }
}
