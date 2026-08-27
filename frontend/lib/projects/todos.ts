/**
 * Project work, projected onto the platform ToDo spine — the same infrastructure the build portal uses.
 *
 * ── WHY A PROJECTION AND NOT A SECOND QUEUE ──────────────────────────────────────────────────
 * `project_milestone_tasks` is the project's own checklist: ordered under a milestone, gating its
 * completion, carrying the domain rules. The platform `tasks` table is something else — it is the
 * place a PERSON looks: `/todos`, the notification bell, the Command Center, and the nudge sweep
 * that already chases everything else in the product.
 *
 * Building a second nudge path and a second queue for projects would give a customer two inboxes and
 * us two things to keep in step. So assigned project work is PROJECTED onto a real ToDo, exactly as
 * `editPortalWorkflow` re-projects a proposal's guardrail plan onto live `tasks` rows. The checklist
 * stays the domain object; the ToDo is how it reaches a human.
 *
 * ── THE ONE RULE THAT KEEPS THEM HONEST ──────────────────────────────────────────────────────
 * **The project task is the source of truth; the ToDo follows it.** Ticking the checklist closes the
 * ToDo; closing the milestone or the project closes whatever is left over. Nothing here ever writes
 * back into `project_milestone_tasks` — a mirror that can move the thing it mirrors is not a mirror,
 * it is a second writer, and the two disagree the first time one of them fails.
 *
 * ── AND WHY THE PROJECT SWEEP STOPS AT UNASSIGNED WORK ───────────────────────────────────────
 * `_run_project_nudges` nudges milestones and tasks by date. A task with an assignee now also has a
 * ToDo, which the platform sweeper nudges. Two reminders for one task teaches people to filter both,
 * so the project sweep skips assigned tasks and the ToDo carries them — see the predicate in
 * `pipeline/src/lifecycle_scheduler.py`.
 *
 * Every function here is BEST-EFFORT and returns rather than throws: a project task that saved must
 * not fail because a notification did not. The failure is logged, and the checklist is still right.
 */
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { createTask, completeTask } from '@/lib/tasks/tasks';
import type { Role } from '@/lib/rbac';
import type { ProjectActor } from './access';
import { isoDate } from './dates';

/** The platform actor shape `lib/tasks` wants, from the project actor we hold. */
function asTaskActor(actor: ProjectActor, email: string | null = null) {
  return { id: actor.userId, email, role: actor.role as Role, tenantId: actor.tenantId };
}

/**
 * Nudge cadence for project work: a week out, two days out, then on the day.
 *
 * Front-loaded on purpose. A reminder that arrives the morning something is due is not a reminder,
 * it is a report — the useful one is early enough to do something about.
 */
const NUDGE_DAYS = [7, 2, 0];

/**
 * Raise the ToDo for a newly assigned project task.
 *
 * Returns the ToDo id so the caller can record it, or null when there is nobody to tell — an
 * unassigned task has no queue to land in, and inventing a broadcast for it would put every
 * employee's name on work nobody has taken.
 */
export async function raiseTaskTodo(
  actor: ProjectActor,
  task: {
    id: string; projectId: string;
    /** NULL for a `scope: 'project'` task — standing work with no phase (mig 221). */
    milestoneId: string | null; title: string;
    assigneeUserId: string | null; assigneeRole: string | null; dueDate: string | null;
  },
  projectName: string,
): Promise<string | null> {
  if (!task.assigneeUserId && !task.assigneeRole) return null;
  try {
    const due = isoDate(task.dueDate);
    const res = await createTask({
      actor: asTaskActor(actor),
      tenantId: actor.tenantId,
      assigneeUserId: task.assigneeUserId,
      assigneeRole: task.assigneeUserId ? null : task.assigneeRole,
      taskType: 'project_task',
      title: task.title,
      description: `On ${projectName}. Tick it off in the project workspace when it is done.`,
      // The ToDo points at the CHECKLIST ROW, not at the project — so completing the checklist can
      // find and close exactly this ToDo, and a project with forty tasks does not close forty ToDos
      // when one of them is ticked.
      entityType: 'project_milestone_task',
      entityId: task.id,
      dueAt: due ? `${due}T17:00:00Z` : null,
      nudgeDays: NUDGE_DAYS,
      params: { projectId: task.projectId, milestoneId: task.milestoneId },
    });
    if (!res.ok) {
      console.error('[projects/todos] raiseTaskTodo refused:', res.error);
      return null;
    }

    // ── THE EMAIL, THROUGH THE ONE SEAM ────────────────────────────────────────────────────
    // Not a direct send: `system:notification.requested` is the path the digest and every other
    // grouped mail take, so delivery, suppression and the ledger are the CRM's single
    // implementation rather than a second one living here. The renderer ships in the same change
    // (services/cms/src/templates.py) — a template named by code and defined nowhere emits
    // `notification.failed` instead of sending, twice over in this repo's history.
    await emitEventSingle({
      namespace: 'system',
      type: 'notification.requested',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        channel: 'email',
        template: 'project_task_assigned',
        tenant_ids: [actor.tenantId],
        assigneeUserId: task.assigneeUserId,
        title: task.title,
        project: projectName,
        dueOn: due,
        taskId: task.id,
        projectId: task.projectId,
      },
    });
    return res.data.taskId ?? null;
  } catch (err) {
    console.error('[projects/todos] raiseTaskTodo failed:', err);
    return null;
  }
}

/**
 * Close the ToDo(s) standing against one checklist row.
 *
 * Plural because a task can be reassigned — the old holder's ToDo and the new one's both point at
 * the same checklist row, and finishing the work finishes both.
 */
export async function closeTaskTodos(
  actor: ProjectActor,
  taskId: string,
  why: Record<string, unknown> = {},
): Promise<number> {
  try {
    const open = await sql<{ id: string }[]>`
      SELECT id FROM tasks
       WHERE entity_type = 'project_milestone_task' AND entity_id = ${taskId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid AND status = 'open'`;
    let closed = 0;
    for (const t of open) {
      const r = await completeTask({ taskId: t.id, actor: asTaskActor(actor), result: why });
      if (r.ok) closed += 1;
    }
    return closed;
  } catch (err) {
    console.error('[projects/todos] closeTaskTodos failed:', err);
    return 0;
  }
}

/**
 * Close every project ToDo left standing under a milestone or a whole project.
 *
 * The sweep-up after a gate closes. A milestone cannot be met with open checklist rows, so in the
 * normal path there is nothing here to do — but a task can be REASSIGNED or a ToDo can survive a
 * failure, and a person's queue holding work on a finished phase is the kind of thing that quietly
 * erodes trust in the queue itself.
 *
 * `completeTask` is used rather than `closeTasksForEntity`, which requires `rfp_admin`: this runs as
 * the tenant's own admin, and a tenant act should not need platform authority.
 */
export async function closeTodosUnder(
  actor: ProjectActor,
  scope: { milestoneId?: string; projectId?: string },
  why: Record<string, unknown> = {},
): Promise<number> {
  try {
    const rows = scope.milestoneId
      ? await sql<{ id: string }[]>`
          SELECT t.id FROM tasks t
            JOIN project_milestone_tasks p ON p.id = t.entity_id
           WHERE t.entity_type = 'project_milestone_task' AND t.status = 'open'
             AND t.tenant_id = ${actor.tenantId}::uuid
             AND p.milestone_id = ${scope.milestoneId}::uuid`
      : await sql<{ id: string }[]>`
          SELECT t.id FROM tasks t
            JOIN project_milestone_tasks p ON p.id = t.entity_id
           WHERE t.entity_type = 'project_milestone_task' AND t.status = 'open'
             AND t.tenant_id = ${actor.tenantId}::uuid
             AND p.project_id = ${scope.projectId ?? null}::uuid`;
    let closed = 0;
    for (const t of rows) {
      const r = await completeTask({ taskId: t.id, actor: asTaskActor(actor), result: why });
      if (r.ok) closed += 1;
    }
    return closed;
  } catch (err) {
    console.error('[projects/todos] closeTodosUnder failed:', err);
    return 0;
  }
}
