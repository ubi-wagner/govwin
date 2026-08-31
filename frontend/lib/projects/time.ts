/**
 * Labour actuals — the source the cost measure never had.
 *
 * ── WHAT WAS WRONG ───────────────────────────────────────────────────────────────────────────
 * `lib/projects/rollup.ts` reported cost against a column **nothing had ever written**. Its honest
 * `null` → "not measured" was hiding a missing INPUT, not a missing number — which is a worse kind
 * of empty, because it reads as restraint.
 *
 * ── TIME GOES TO A MILESTONE ─────────────────────────────────────────────────────────────────
 * The milestone IS the WBS element (mig 228) — the level the plan is costed at, and the level the
 * CLIN grouping lives at, so twelve monthly milestones all roll up to CLIN 0002 without anybody
 * re-tagging an entry. A task may be tagged as well, for people who want to know which piece of
 * work the hours went to, but the milestone carries the money.
 *
 * Hours with no place in the breakdown cannot roll up to a CLIN at all, and a cost measure that
 * silently dropped them would be worse than one reporting nothing.
 *
 * ── THE RATE IS COPIED, NOT LOOKED UP ────────────────────────────────────────────────────────
 * `hourly_rate` is the rate AT THE TIME. Resolved later, history re-prices itself every time
 * somebody gets a raise, and last year's cost report stops matching last year's invoice.
 *
 * ── AND LOGGING IS NOT APPROVING ─────────────────────────────────────────────────────────────
 * The fifth time this module draws that line. Anyone on the project logs their own hours; a
 * `tenant_admin` approves them; and **only approved hours count toward cost**, because hours are
 * what a customer is billed for and "somebody typed it" is not the same claim as "a manager
 * checked it".
 */
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { canAccessProject, canAssign, type ProjectActor } from './access';
import type { Fail, Ok } from './project';

export interface TimeEntry {
  id: string;
  projectId: string;
  milestoneId: string;
  milestoneTitle?: string | null;
  milestoneCode?: string | null;
  taskId: string | null;
  userId: string;
  userEmail?: string | null;
  workedOn: string | null;
  hours: string;
  hourlyRate: string | null;
  cost: string;
  note: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}

/** Hours: positive, at most 24 in a day, at most two decimals. */
function asHours(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 24) return null;
  return Math.round(n * 100) / 100;
}

export async function listTimeEntries(
  tenantId: string,
  projectId: string,
): Promise<TimeEntry[]> {
  try {
    return await sql<TimeEntry[]>`
      SELECT e.id, e.project_id, e.milestone_id, m.title AS milestone_title, m.code AS milestone_code,
             e.task_id, e.user_id, u.email AS user_email, e.worked_on, e.hours, e.hourly_rate,
             e.cost, e.note, e.approved_by, e.approved_at
        FROM project_time_entries e
        JOIN project_milestones m ON m.id = e.milestone_id
        LEFT JOIN users u ON u.id = e.user_id
       WHERE e.project_id = ${projectId}::uuid AND e.tenant_id = ${tenantId}::uuid
       ORDER BY e.worked_on DESC, e.created_at DESC`;
  } catch (err) {
    console.error('[projects/time] listTimeEntries failed:', err);
    return [];
  }
}

export async function logTime(
  actor: ProjectActor,
  projectId: string,
  input: {
    milestoneId?: string; taskId?: string | null; workedOn?: string;
    hours?: number | string; hourlyRate?: number | string | null; note?: string | null;
    /** Logging on somebody else's behalf — `tenant_admin` only. */
    userId?: string | null;
  },
): Promise<Ok<TimeEntry> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  if (!input.milestoneId) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'Say which milestone the hours went to — hours with no place in the breakdown '
        + 'cannot roll up to a CLIN.',
    };
  }
  const hours = asHours(input.hours);
  if (hours === null) {
    return { ok: false, status: 400, error: 'hours must be greater than 0 and at most 24', code: 'VALIDATION_ERROR' };
  }
  const workedOn = (input.workedOn ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workedOn)) {
    return { ok: false, status: 400, error: 'workedOn must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }
  const rate = input.hourlyRate === null || input.hourlyRate === undefined || input.hourlyRate === ''
    ? null : Number(input.hourlyRate);
  if (rate !== null && (!Number.isFinite(rate) || rate < 0)) {
    return { ok: false, status: 400, error: 'hourlyRate must be a positive number', code: 'VALIDATION_ERROR' };
  }
  // Logging FOR somebody else is a management act — it puts hours in another person's name, and a
  // timesheet anybody can write on another's behalf is not a timesheet.
  const userId = input.userId && input.userId !== actor.userId ? input.userId : actor.userId;
  if (userId !== actor.userId && !canAssign(actor.role)) {
    return {
      ok: false, status: 403, code: 'FORBIDDEN',
      error: 'Only a tenant admin can log time on somebody else&apos;s behalf.'.replace('&apos;', "'"),
    };
  }

  try {
    // FK-before-write, scoped to THIS project: a milestone id from another contract satisfies the
    // FK and would bill one customer's hours to another's CLIN.
    const [node] = await sql<{ id: string; code: string | null; title: string }[]>`
      SELECT id, code, title FROM project_milestones
       WHERE id = ${input.milestoneId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!node) {
      return { ok: false, status: 400, error: 'That milestone does not belong to this project', code: 'VALIDATION_ERROR' };
    }
    if (input.taskId) {
      const [task] = await sql<{ id: string }[]>`
        SELECT id FROM project_milestone_tasks
         WHERE id = ${input.taskId}::uuid AND project_id = ${projectId}::uuid
           AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
      if (!task) {
        return { ok: false, status: 400, error: 'That task does not belong to this project', code: 'VALIDATION_ERROR' };
      }
    }

    const [row] = await sql<TimeEntry[]>`
      INSERT INTO project_time_entries
        (tenant_id, project_id, milestone_id, task_id, user_id, worked_on, hours, hourly_rate, note)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${input.milestoneId}::uuid,
         ${input.taskId ?? null}, ${userId}::uuid, ${workedOn}::date, ${hours},
         ${rate}, ${(input.note ?? '').trim() || null})
      RETURNING id, project_id, milestone_id, task_id, user_id, worked_on, hours, hourly_rate,
                cost, note, approved_by, approved_at`;
    if (!row) return { ok: false, status: 500, error: 'Failed to log the time', code: 'DB_ERROR' };

    await emitEventSingle({
      namespace: 'project',
      type: 'time.logged',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, entryId: row.id, milestoneId: input.milestoneId, milestone: node.title,
        hours, workedOn, onBehalfOf: userId !== actor.userId ? userId : undefined,
      },
    });
    return { ok: true, data: { ...row, milestoneCode: node.code, milestoneTitle: node.title } };
  } catch (err) {
    console.error('[projects/time] logTime failed:', err);
    return { ok: false, status: 500, error: 'Failed to log the time', code: 'DB_ERROR' };
  }
}

/**
 * Approve time. `tenant_admin` — this is what turns hours into cost, and into an invoice.
 *
 * Many at once, because that is how a timesheet is reviewed: a week of somebody's entries, read
 * together. One-at-a-time approval of forty rows is a form nobody finishes.
 */
export async function approveTime(
  actor: ProjectActor,
  projectId: string,
  entryIds: string[],
): Promise<Ok<{ approved: number }> | Fail> {
  if (!canAssign(actor.role)) {
    return {
      ok: false, status: 403, code: 'FORBIDDEN',
      error: 'Only a tenant admin can approve time — approving is what turns hours into cost.',
    };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  if (!Array.isArray(entryIds) || entryIds.length === 0) {
    return { ok: false, status: 400, error: 'Send at least one entry to approve', code: 'VALIDATION_ERROR' };
  }

  try {
    const approvedAt = new Date();
    // Scoped by project AND already-unapproved: re-approving cannot re-stamp who signed off, and
    // an id from another project cannot be swept in with a list.
    const rows = await sql<{ id: string; cost: string }[]>`
      UPDATE project_time_entries
         SET approved_by = ${actor.userId}::uuid, approved_at = ${approvedAt}, updated_at = now()
       WHERE id = ANY(${entryIds}::uuid[])
         AND project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND approved_at IS NULL
      RETURNING id, cost`;

    if (rows.length > 0) {
      const total = rows.reduce((n, r) => n + Number(r.cost ?? 0), 0);
      await emitEventSingle({
        namespace: 'project',
        type: 'time.approved',
        actor: userActor(actor.userId),
        tenantId: actor.tenantId,
        payload: { projectId, entries: rows.length, cost: Math.round(total * 100) / 100 },
      });
      await auditLog({
        tenantId: actor.tenantId, userId: actor.userId, action: 'project.time_approved',
        entityType: 'project', entityId: projectId,
        metadata: { entries: rows.length, cost: total },
      });
    }
    return { ok: true, data: { approved: rows.length } };
  } catch (err) {
    console.error('[projects/time] approveTime failed:', err);
    return { ok: false, status: 500, error: 'Failed to approve the time', code: 'DB_ERROR' };
  }
}

/** Remove an entry. Your own, while it is unapproved — approved hours are a billing record. */
export async function deleteTimeEntry(
  actor: ProjectActor,
  projectId: string,
  entryId: string,
): Promise<Ok<{ entryId: string }> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Not found', code: 'NOT_FOUND' };
  }
  try {
    const [row] = await sql<{ id: string; userId: string; approvedAt: string | null }[]>`
      SELECT id, user_id, approved_at FROM project_time_entries
       WHERE id = ${entryId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!row) return { ok: false, status: 404, error: 'Not found', code: 'NOT_FOUND' };
    if (row.approvedAt) {
      return {
        ok: false, status: 409, code: 'ALREADY_APPROVED',
        error: 'Approved hours are a billing record. Ask an admin to correct it instead.',
      };
    }
    if (row.userId !== actor.userId && !canAssign(actor.role)) {
      return { ok: false, status: 403, code: 'FORBIDDEN', error: 'That is somebody else&apos;s time entry.'.replace('&apos;', "'") };
    }
    await sql`DELETE FROM project_time_entries WHERE id = ${entryId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
    return { ok: true, data: { entryId } };
  } catch (err) {
    console.error('[projects/time] deleteTimeEntry failed:', err);
    return { ok: false, status: 500, error: 'Failed to remove the entry', code: 'DB_ERROR' };
  }
}
