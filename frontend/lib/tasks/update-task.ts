/**
 * Mutate a LIVE workflow ToDo — reassign / reschedule / re-nudge (TW-4,
 * docs/TENANT_WORKFLOW_SETUP_DESIGN.md §5 PATCH B). The frozen model had no path to change a task's
 * assignee, due date, or nudge cadence after creation; this is that path, for the day-to-day quick
 * action (the workflow-config editor handles the same via re-projection at the stage level).
 *
 * Invariant-safe: only an OPEN/in_progress task can change; a timing change RESETS `nudges_sent` so the
 * pipeline sweep re-fires against the new `due_at`/`nudge_schedule` (the exact rows it reads); a named
 * assignee must be an active member of the tenant. Runs in the tenant RLS context (the `tasks` ledger is
 * RLS-forced). Single-fact audit (capture:task.reassigned / task.rescheduled).
 */
import { sql } from '@/lib/db';
import { runInTenant } from '@/lib/tenant-context';
import { emitEventSingle, userActor } from '@/lib/events';
import type { Role } from '@/lib/rbac';

const jsonParam = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

export interface UpdateTaskInput {
  actor: { id: string; email: string | null; role: Role; tenantId: string };
  tenantId: string;
  taskId: string;
  /** undefined = leave; a non-empty string = a named person (clears the role); other = fall to role. */
  assigneeUserId?: string | null;
  assigneeRole?: string | null;
  /** undefined = leave; string = set absolute due; null = clear the due. Resets the nudge watermark. */
  dueAt?: string | null;
  /** undefined = leave; else the new days-before-due schedule. Resets the nudge watermark. */
  nudgeSchedule?: number[];
}
export interface UpdateTaskResult { ok: boolean; error?: string; code?: string; status?: number; changed?: string[] }

export async function updateTask(input: UpdateTaskInput): Promise<UpdateTaskResult> {
  const { actor, tenantId, taskId } = input;
  return runInTenant(tenantId, async (): Promise<UpdateTaskResult> => {
    const [task] = await sql<Array<{ status: string; title: string | null }>>`
      SELECT status, title FROM tasks WHERE tenant_id = ${tenantId}::uuid AND id = ${taskId}::uuid LIMIT 1`;
    if (!task) return { ok: false, error: 'to-do not found', code: 'NOT_FOUND', status: 404 };
    if (task.status !== 'open' && task.status !== 'in_progress') {
      return { ok: false, error: 'only an open to-do can be changed', code: 'CONFLICT', status: 409 };
    }

    const changed: string[] = [];
    let newUserId: string | null = null;
    let newRole: string | null = null;

    if (input.assigneeUserId !== undefined || input.assigneeRole !== undefined) {
      if (typeof input.assigneeUserId === 'string' && input.assigneeUserId) {
        const [m] = await sql<Array<{ ok: number }>>`
          SELECT 1 AS ok FROM user_memberships
          WHERE user_id = ${input.assigneeUserId}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'active' LIMIT 1`;
        if (!m) return { ok: false, error: 'the assignee is not an active member of this tenant', code: 'VALIDATION_ERROR', status: 422 };
        newUserId = input.assigneeUserId; newRole = null;
      } else {
        newUserId = null; newRole = input.assigneeRole ?? 'tenant_user';
      }
      await sql`UPDATE tasks SET assignee_user_id = ${newUserId}, assignee_role = ${newRole}
                WHERE tenant_id = ${tenantId}::uuid AND id = ${taskId}::uuid AND status IN ('open','in_progress')`;
      changed.push('assignee');
    }

    if (input.dueAt !== undefined || input.nudgeSchedule !== undefined) {
      if (input.dueAt !== undefined) {
        await sql`UPDATE tasks SET due_at = ${input.dueAt}
                  WHERE tenant_id = ${tenantId}::uuid AND id = ${taskId}::uuid AND status IN ('open','in_progress')`;
      }
      if (input.nudgeSchedule !== undefined) {
        const sched = Array.isArray(input.nudgeSchedule) ? input.nudgeSchedule.filter((n) => typeof n === 'number' && n > 0) : [];
        await sql`UPDATE tasks SET nudge_schedule = ${jsonParam(sched)}
                  WHERE tenant_id = ${tenantId}::uuid AND id = ${taskId}::uuid AND status IN ('open','in_progress')`;
      }
      // A timing change re-arms the reminders: clear the watermark so the sweep re-fires against the new due.
      await sql`UPDATE tasks SET nudges_sent = '[]'::jsonb WHERE tenant_id = ${tenantId}::uuid AND id = ${taskId}::uuid`;
      changed.push('schedule');
    }

    if (changed.length === 0) return { ok: false, error: 'nothing to change', code: 'VALIDATION_ERROR', status: 400 };

    try {
      if (changed.includes('assignee')) {
        await emitEventSingle({
          namespace: 'capture', type: 'task.reassigned', actor: userActor(actor.id, actor.email ?? undefined), tenantId,
          payload: { taskId, title: task.title, assigneeUserId: newUserId, assigneeRole: newRole },
        });
      }
      if (changed.includes('schedule')) {
        await emitEventSingle({
          namespace: 'capture', type: 'task.rescheduled', actor: userActor(actor.id, actor.email ?? undefined), tenantId,
          payload: { taskId, title: task.title, dueAt: input.dueAt ?? null },
        });
      }
    } catch (e) { console.error('[updateTask] event emit failed (non-fatal)', e); }

    return { ok: true, changed };
  });
}
