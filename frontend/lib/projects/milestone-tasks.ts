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
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { canAccessProject, canAssign, type ProjectActor } from './access';
import { isoDate } from './dates';
import { raiseTaskTodo, closeTaskTodos } from './todos';
import type { Fail, Ok } from './project';

export interface MilestoneTask {
  id: string;
  projectId: string;
  /** NULL for a `scope: 'project'` task. Read `scope`, not this — see migration 221. */
  milestoneId: string | null;
  /** 'milestone' gates its milestone and obeys the date rule; 'project' is standing work. */
  scope: 'milestone' | 'project';
  title: string;
  detail: string | null;
  assigneeUserId: string | null;
  assigneeRole: string | null;
  assigneeEmail?: string | null;
  dueDate: string | null;
  /** The ASSIGNEE's own forecast — deliberately unconstrained by the milestone date. */
  estimatedCompletion: string | null;
  status: 'open' | 'done' | 'blocked';
  blockedReason: string | null;
  completedAt: string | null;
  completedBy: string | null;
  sortIndex: number;
}

// The RETURNING column list is repeated in each statement below rather than hoisted into a shared
// fragment. `lib/db.ts`'s `sql` is a Proxy that routes only the tagged-template CALL, so a hoisted
// ``sql`id, project_id, …` `` is a PROMISE, not a fragment — the third Proxy trap, and it would
// interpolate as a serialisation error rather than as column names.

/**
 * Turn migration 221's SQLSTATEs into the product's own refusals.
 *
 * The trigger raises the truth; a constraint name is not a sentence a person can act on. Each of
 * these has a different next action, so each gets its own code — the same reason
 * `TASKS_OUTSTANDING` and `DELIVERABLES_OUTSTANDING` are separate messages rather than one
 * "not ready".
 */
function fromTrigger(err: unknown): Fail | null {
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: string })?.message ?? '');
  switch (code) {
    case '23002':
      return { ok: false, status: 400, code: 'CROSS_PROJECT_DEPENDENCY',
        error: 'A milestone can only depend on another in the same project.' };
    case '23003':
      return { ok: false, status: 409, code: 'DEPENDENCY_LOOP',
        error: 'That dependency would make a loop — this milestone already comes before that one.' };
    case '23004':
      return { ok: false, status: 409, code: 'DUE_AFTER_MILESTONE',
        error: `${message.replace(/^[^:]*:\s*/, '')}. Move the milestone first, or bring the task in.` };
    case '23005':
      return { ok: false, status: 409, code: 'TASKS_WOULD_STRAND',
        error: `${message.replace(/^[^:]*:\s*/, '')}. Move them first — pulling a milestone in does not `
          + 'move dates people committed to.' };
    default:
      return null;
  }
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
      SELECT t.id, t.project_id, t.milestone_id, t.scope, t.title, t.detail,
             t.assignee_user_id, t.assignee_role, u.email AS assignee_email,
             t.due_date, t.estimated_completion, t.status, t.blocked_reason,
             t.completed_at, t.completed_by, t.sort_index
        FROM project_milestone_tasks t
        LEFT JOIN users u ON u.id = t.assignee_user_id
       WHERE t.project_id = ${projectId}::uuid AND t.tenant_id = ${tenantId}::uuid
       ORDER BY t.scope DESC, t.sort_index, t.created_at`;
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
    /** Omit (or null) for standing project work — see `scope` and migration 221. */
    milestoneId?: string | null; title: string; detail?: string | null;
    assigneeUserId?: string | null; assigneeRole?: string | null;
    dueDate?: string | null; estimatedCompletion?: string | null; sortIndex?: number;
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
  const est = asDate(input.estimatedCompletion);
  if (!est.ok) {
    return { ok: false, status: 400, error: 'estimatedCompletion must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }
  if (input.assigneeRole && !['tenant_admin', 'tenant_user'].includes(input.assigneeRole)) {
    return { ok: false, status: 400, error: 'assigneeRole must be tenant_admin or tenant_user', code: 'VALIDATION_ERROR' };
  }
  // The scope is DERIVED from whether a milestone was named, never taken from the caller. Two
  // inputs that must agree is two inputs that will disagree, and mig 221's paired CHECK would then
  // answer with a constraint name instead of a sentence.
  const milestoneId = input.milestoneId ?? null;
  const scope: 'milestone' | 'project' = milestoneId ? 'milestone' : 'project';

  try {
    // FK-before-write, scoped to THIS project. A milestone id from another project satisfies the
    // FK perfectly and would hang one contract's task off another's phase.
    if (milestoneId) {
      const [ms] = await sql<{ id: string }[]>`
        SELECT id FROM project_milestones
         WHERE id = ${milestoneId}::uuid AND project_id = ${projectId}::uuid
           AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
      if (!ms) {
        return { ok: false, status: 400, error: 'That milestone does not belong to this project', code: 'VALIDATION_ERROR' };
      }
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
        (tenant_id, project_id, milestone_id, scope, title, detail, assignee_user_id, assignee_role,
         due_date, estimated_completion, sort_index, created_by)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${milestoneId}, ${scope}, ${title},
         ${input.detail ?? null}, ${input.assigneeUserId ?? null}, ${input.assigneeRole ?? null},
         ${due.value}, ${est.value}, ${input.sortIndex ?? 0}, ${actor.userId}::uuid)
      RETURNING id, project_id, milestone_id, scope, title, detail, assignee_user_id, assignee_role,
                due_date, estimated_completion, status, blocked_reason, completed_at, completed_by,
                sort_index`;
    if (!row) return { ok: false, status: 500, error: 'Failed to add the task', code: 'DB_ERROR' };

    await emitEventSingle({
      namespace: 'project',
      type: 'task.created',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, milestoneId, taskId: row.id, title },
    });

    // Project the assignment onto the platform ToDo spine — the queue, the bell, the Command
    // Center and the shared nudge sweep — so a person meets project work where they meet
    // everything else. Best-effort by construction: the checklist row is already saved and correct.
    const [proj] = await sql<{ name: string }[]>`
      SELECT name FROM projects WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
    await raiseTaskTodo(actor, {
      id: row.id, projectId, milestoneId, title,
      assigneeUserId: input.assigneeUserId ?? null, assigneeRole: input.assigneeRole ?? null,
      dueDate: due.value,
    }, proj?.name ?? 'a project');

    return { ok: true, data: row };
  } catch (err) {
    // Migration 221's date rule reaches us here: the trigger is what enforces it, on BOTH write
    // paths, so this is where a task due after its milestone becomes a sentence.
    const refusal = fromTrigger(err);
    if (refusal) return refusal;
    console.error('[projects/milestone-tasks] createMilestoneTask failed:', err);
    return { ok: false, status: 500, error: 'Failed to add the task', code: 'DB_ERROR' };
  }
}

/**
 * Edit a task in flight: who owns it, when it is due, what they now expect, and the note.
 *
 * ── OPEN TO ANY MEMBER ON THE PROJECT ────────────────────────────────────────────────────────
 * Day-to-day rearranging is the work, not a management act. Creating a task stays `tenant_admin`
 * because that is adding scope; handing one to whoever is free, or moving it a week, is the team
 * doing its job. A plan only a manager can rearrange is a plan that goes stale between meetings.
 *
 * Every change emits an event carrying who moved what, from what, to what — so "open to anyone"
 * means visible, not untracked. That is the same trade the section-editing spine makes.
 *
 * ── THE TWO DATES ARE NOT THE SAME KIND OF THING ─────────────────────────────────────────────
 * `dueDate` is the commitment and mig 221's trigger holds it inside the milestone.
 * `estimatedCompletion` is the assignee's own forecast, and it is deliberately free to run past —
 * that gap is the early warning, and a system that refused it would only teach people to enter the
 * date it accepts.
 */
export async function updateTask(
  actor: ProjectActor,
  projectId: string,
  taskId: string,
  patch: {
    assigneeUserId?: string | null;
    assigneeRole?: string | null;
    dueDate?: string | null;
    estimatedCompletion?: string | null;
    detail?: string | null;
  },
): Promise<Ok<MilestoneTask> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Task not found', code: 'NOT_FOUND' };
  }

  const touchesAssignee = 'assigneeUserId' in patch || 'assigneeRole' in patch;
  const due = asDate(patch.dueDate);
  if (!due.ok) {
    return { ok: false, status: 400, error: 'dueDate must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }
  const est = asDate(patch.estimatedCompletion);
  if (!est.ok) {
    return { ok: false, status: 400, error: 'estimatedCompletion must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }
  // Validated unconditionally, APPLIED conditionally. `asDate(undefined)` is a legal null, so a
  // patch that never mentions a date passes this and then falls through to the `in` checks below —
  // which are what distinguish "clear it" (an explicit null) from "leave it" (absent).
  if (patch.assigneeRole && !['tenant_admin', 'tenant_user'].includes(patch.assigneeRole)) {
    return { ok: false, status: 400, error: 'assigneeRole must be tenant_admin or tenant_user', code: 'VALIDATION_ERROR' };
  }

  try {
    const [before] = await sql<(MilestoneTask & { nudgesSent: number })[]>`
      SELECT id, project_id, milestone_id, scope, title, detail, assignee_user_id, assignee_role,
             due_date, estimated_completion, status, blocked_reason, completed_at, completed_by,
             sort_index, nudges_sent
        FROM project_milestone_tasks
       WHERE id = ${taskId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!before) return { ok: false, status: 404, error: 'Task not found', code: 'NOT_FOUND' };

    // The same boundary `createMilestoneTask` enforces, for the same reason: work handed to somebody
    // who cannot open the project is a silent dead end, and granting project access as a side effect
    // of a reassignment form would make the boundary mean nothing.
    if (patch.assigneeUserId) {
      const [onProject] = await sql<{ userId: string }[]>`
        SELECT a.user_id FROM project_assignments a
          JOIN user_memberships m ON m.user_id = a.user_id AND m.tenant_id = ${actor.tenantId}::uuid
         WHERE a.project_id = ${projectId}::uuid AND a.tenant_id = ${actor.tenantId}::uuid
           AND a.user_id = ${patch.assigneeUserId}::uuid AND m.status = 'active' LIMIT 1`;
      if (!onProject) {
        return {
          ok: false, status: 409, code: 'NOT_ON_PROJECT',
          error: 'That person is not on this project, so they would never see the task. '
            + 'Add them to the project first.',
        };
      }
    }

    // COALESCE on a per-field flag rather than on the value: `null` is a MEANING here (unassign,
    // clear the date), so a plain COALESCE would make "clear it" indistinguishable from "leave it".
    const nextAssigneeUser = touchesAssignee ? (patch.assigneeUserId ?? null) : before.assigneeUserId;
    // A person and a role are alternatives, not a pair — naming a person clears the role bucket, the
    // same rule `raiseTaskTodo` already applies when it decides where the ToDo lands.
    const nextAssigneeRole = touchesAssignee
      ? (patch.assigneeUserId ? null : (patch.assigneeRole ?? null))
      : before.assigneeRole;
    const nextDue = 'dueDate' in patch ? due.value : before.dueDate;
    const nextEst = 'estimatedCompletion' in patch ? est.value : before.estimatedCompletion;
    const nextDetail = 'detail' in patch ? (patch.detail?.trim() || null) : before.detail;
    // `isoDate` on both sides: a `date` column arrives as a JavaScript Date, and comparing a Date
    // to the ISO string the caller sent is always "different" — which would reset the nudge
    // watermark and re-raise a ToDo on every save that touched nothing.
    const dateMoved = isoDate(nextDue) !== isoDate(before.dueDate);
    // The date moved, so the nudge history is about a deadline that no longer exists. Resetting the
    // watermark is what makes the sweeper re-fire against the NEW due — exactly what
    // `editPortalWorkflow` does when it re-projects a guardrail plan onto live task rows.
    //
    // A plain JS value, carried from the row read above. Writing this as a conditional SQL fragment
    // in the value position is the third Proxy trap: a nested tagged template there is a Promise,
    // not a fragment, and postgres.js throws serialising it. (Broken here once, within minutes of
    // quoting the rule two functions up.)
    const nextNudges = dateMoved ? 0 : (before.nudgesSent ?? 0);

    const [row] = await sql<MilestoneTask[]>`
      UPDATE project_milestone_tasks
         SET assignee_user_id     = ${nextAssigneeUser},
             assignee_role        = ${nextAssigneeRole},
             due_date             = ${nextDue}::date,
             estimated_completion = ${nextEst}::date,
             detail               = ${nextDetail},
             -- nudges_sent: a PLAIN VALUE computed above, see the note on nextNudges.
             nudges_sent          = ${nextNudges},
             updated_at           = now()
       WHERE id = ${taskId}::uuid AND tenant_id = ${actor.tenantId}::uuid
      RETURNING id, project_id, milestone_id, scope, title, detail, assignee_user_id, assignee_role,
                due_date, estimated_completion, status, blocked_reason, completed_at, completed_by,
                sort_index`;
    if (!row) return { ok: false, status: 404, error: 'Task not found', code: 'NOT_FOUND' };

    const reassigned = touchesAssignee
      && (before.assigneeUserId !== row.assigneeUserId || before.assigneeRole !== row.assigneeRole);
    // Same `isoDate` normalisation as above — `before.dueDate` and `row.dueDate` are both Dates,
    // but comparing Date objects by `!==` is always true, so this would fire on every save.
    const rescheduled = isoDate(before.dueDate) !== isoDate(row.dueDate);

    if (reassigned) {
      await emitEventSingle({
        namespace: 'project',
        type: 'task.reassigned',
        actor: userActor(actor.userId),
        tenantId: actor.tenantId,
        payload: {
          projectId, milestoneId: row.milestoneId, taskId, title: row.title,
          from: before.assigneeUserId ?? before.assigneeRole,
          to: row.assigneeUserId ?? row.assigneeRole,
        },
      });
    }
    if (rescheduled) {
      await emitEventSingle({
        namespace: 'project',
        type: 'task.rescheduled',
        actor: userActor(actor.userId),
        tenantId: actor.tenantId,
        payload: {
          projectId, milestoneId: row.milestoneId, taskId, title: row.title,
          from: isoDate(before.dueDate), to: isoDate(row.dueDate),
        },
      });
    }

    // ── THE PROJECTION FOLLOWS THE CHECKLIST ────────────────────────────────────────────────
    // Reassigning closes the previous holder's ToDo and raises one for the new owner. Leaving the
    // old one open would keep finished-for-them work in someone's queue, which is precisely how a
    // queue stops being believed. `closeTaskTodos` is plural because BOTH can point at this row.
    // Rescheduling alone also re-raises: the ToDo carries `due_at`, and a stale one would nudge
    // against a date nobody holds any more.
    if (reassigned || rescheduled) {
      await closeTaskTodos(actor, taskId, {
        via: reassigned ? 'reassigned' : 'rescheduled',
        by: actor.userId,
      });
      const [proj] = await sql<{ name: string }[]>`
        SELECT name FROM projects WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
      await raiseTaskTodo(actor, {
        id: row.id, projectId, milestoneId: row.milestoneId, title: row.title,
        assigneeUserId: row.assigneeUserId, assigneeRole: row.assigneeRole,
        dueDate: isoDate(row.dueDate),
      }, proj?.name ?? 'a project');
    }

    return { ok: true, data: row };
  } catch (err) {
    const refusal = fromTrigger(err);
    if (refusal) return refusal;
    console.error('[projects/milestone-tasks] updateTask failed:', err);
    return { ok: false, status: 500, error: 'Failed to update the task', code: 'DB_ERROR' };
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
      RETURNING id, project_id, milestone_id, scope, title, detail, assignee_user_id, assignee_role,
                due_date, estimated_completion, status, blocked_reason, completed_at, completed_by,
                sort_index`;
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
  dependsOnId?: string | null;
}

/**
 * Set (or clear) which milestone this one follows.
 *
 * Dependencies are between MILESTONES and nowhere else — see migration 221. The same-project and
 * acyclic rules live in the database, so this maps their SQLSTATEs to sentences rather than
 * re-implementing them: an invariant checked in two places is an invariant that disagrees with
 * itself the first time one copy is edited.
 */
export async function setMilestoneDependency(
  actor: ProjectActor,
  projectId: string,
  milestoneId: string,
  dependsOnId: string | null,
): Promise<Ok<{ milestoneId: string; dependsOnId: string | null }> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can change the plan', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Milestone not found', code: 'NOT_FOUND' };
  }
  try {
    const [row] = await sql<{ id: string; dependsOnId: string | null; title: string }[]>`
      UPDATE project_milestones SET depends_on_id = ${dependsOnId}, updated_at = now()
       WHERE id = ${milestoneId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid
      RETURNING id, depends_on_id, title`;
    if (!row) return { ok: false, status: 404, error: 'Milestone not found', code: 'NOT_FOUND' };

    await emitEventSingle({
      namespace: 'project',
      type: 'milestone.dependency_set',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, milestoneId, dependsOnId: row.dependsOnId, title: row.title },
    });
    return { ok: true, data: { milestoneId, dependsOnId: row.dependsOnId } };
  } catch (err) {
    const refusal = fromTrigger(err);
    if (refusal) return refusal;
    console.error('[projects/milestone-tasks] setMilestoneDependency failed:', err);
    return { ok: false, status: 500, error: 'Failed to set the dependency', code: 'DB_ERROR' };
  }
}

/**
 * Which milestones actually follow this one, transitively.
 *
 * With no dependency declared anywhere, this returns nothing and the caller falls back to
 * "everything with a higher sort_index" — the pre-221 behaviour, which is right for a plain serial
 * plan. Once someone declares a dependency, the cascade becomes precise: two phases running in
 * PARALLEL should not both move because one of them slipped, and before 221 they both did.
 *
 * The walk is bounded by the row count as well as by the graph. The database refuses to store a
 * cycle, but a harness or a restore could still present one, and a scheduler that hangs is worse
 * than a scheduler that stops.
 */
function successorsOf(all: MilestoneChainRow[], rootId: string): Set<string> {
  const byParent = new Map<string, string[]>();
  for (const m of all) {
    if (!m.dependsOnId) continue;
    const kids = byParent.get(m.dependsOnId) ?? [];
    kids.push(m.id);
    byParent.set(m.dependsOnId, kids);
  }
  const out = new Set<string>();
  const queue = [rootId];
  let hops = 0;
  while (queue.length && hops < all.length + 1) {
    const next = queue.shift()!;
    for (const kid of byParent.get(next) ?? []) {
      if (out.has(kid)) continue;
      out.add(kid);
      queue.push(kid);
    }
    hops += 1;
  }
  return out;
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
      // Only PENDING milestones move: a met milestone happened on a real date and shifting it would
      // rewrite history to keep a chart tidy.
      const chain = await sql<MilestoneChainRow[]>`
        SELECT id, title, starts_on, forecast_date, baseline_date, status, sort_index, depends_on_id
          FROM project_milestones
         WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         ORDER BY sort_index`;

      // ── DECLARED SUCCESSORS, OR THE SERIAL FALLBACK ────────────────────────────────────────
      // If anyone on this project has declared a dependency, the cascade follows the graph: two
      // phases running in PARALLEL should not both move because one slipped. With no dependency
      // declared, "everything later" is exactly right for a plain serial plan, and is what this
      // did before mig 221 — so an untouched project behaves identically.
      const declared = chain.some((m) => m.dependsOnId);
      const successors = declared ? successorsOf(chain, milestoneId) : null;
      const later = chain.filter((m) => m.status === 'pending' && (
        successors ? successors.has(m.id) : m.sortIndex > target.sortIndex
      ));
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
    return { ok: true, data: { moved, deltaDays } };
  } catch (err) {
    // Pulling a milestone IN can strand tasks committed to later dates. Mig 221's guard refuses and
    // names them; this turns that into the product's own 409 rather than dragging the dates along,
    // because silently moving a date somebody committed to is how a plan stops being believed.
    const refusal = fromTrigger(err);
    if (refusal) return refusal;
    console.error('[projects/milestone-tasks] rescheduleMilestone failed:', err);
    return { ok: false, status: 500, error: 'Failed to reschedule', code: 'DB_ERROR' };
  }
}
