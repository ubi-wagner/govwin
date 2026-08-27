/**
 * Close-out — the end of the project's life, recorded rather than merely flagged.
 *
 * ── IT IS MILESTONE COMPLETION, ONE SCALE UP ─────────────────────────────────────────────────
 * A milestone closes when its work is done and its evidence accepted, and it records a note and
 * metrics. A project closes when every milestone has, and it records the same two things. Two
 * shapes for one idea is how they drift, so this is deliberately the same shape.
 *
 * ── THE GATES, AND WHY THEY ARE SEPARATE MESSAGES ────────────────────────────────────────────
 * `MILESTONES_OUTSTANDING` — phases still running. `DELIVERABLES_OUTSTANDING` — the customer has
 * not accepted the evidence. `TASKS_OUTSTANDING` — work added AFTER a milestone was met, which the
 * milestone gate cannot catch because it ran before the task existed. Three different problems with
 * three different next actions; one "project not ready" would tell nobody what to go and do.
 *
 * ── REVERSIBLE, BECAUSE CLOSE-OUT REOPENS ────────────────────────────────────────────────────
 * A final invoice is disputed, property is unreturned, an audit lands. `reopenProject` clears the
 * stamp and emits its own event; the pair is the history. Nothing is hard-deleted here, in keeping
 * with docs/ARCHIVABLE_CONTRACT.md — and close-out is NOT archive: a closed project is finished
 * business that stays visible, an archived one is out of sight.
 */
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { canAccessProject, canAssign, type ProjectActor } from './access';
import type { Fail, Ok } from './project';

export interface CloseoutResult {
  projectId: string;
  status: string;
  closedAt: string | null;
  milestones: number;
}

/** A named, non-empty list of what is blocking, or null. */
async function blockers(tenantId: string, projectId: string) {
  const [open, unaccepted, tasks] = await Promise.all([
    sql<{ title: string }[]>`
      SELECT title FROM project_milestones
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
         AND status = 'pending' ORDER BY sort_index`,
    sql<{ title: string }[]>`
      SELECT d.title FROM project_deliverables d
        JOIN project_milestones m ON m.id = d.milestone_id
       WHERE m.project_id = ${projectId}::uuid AND d.tenant_id = ${tenantId}::uuid
         AND d.accepted_at IS NULL ORDER BY d.sort_index`,
    sql<{ title: string }[]>`
      SELECT title FROM project_milestone_tasks
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
         AND status <> 'done' ORDER BY sort_index`,
  ]);
  return { open, unaccepted, tasks };
}

const naming = (rows: { title: string }[]) =>
  `${rows.slice(0, 3).map((r) => r.title).join(', ')}${rows.length > 3 ? ', …' : ''}`;

export async function closeProject(
  actor: ProjectActor,
  projectId: string,
  completion: { note?: string | null; metrics?: Record<string, unknown> | null } = {},
): Promise<Ok<CloseoutResult> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can close out a project', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  const metrics = completion.metrics ?? null;
  if (metrics !== null && (typeof metrics !== 'object' || Array.isArray(metrics))) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: 'metrics must be an object of named measurements, e.g. { invoicesPaid: 4 }',
    };
  }
  const note = (completion.note ?? '').trim() || null;

  try {
    const { open, unaccepted, tasks } = await blockers(actor.tenantId, projectId);
    if (open.length) {
      return {
        ok: false, status: 409, code: 'MILESTONES_OUTSTANDING',
        error: `${open.length} milestone(s) are still running: ${naming(open)}.`,
      };
    }
    if (tasks.length) {
      return {
        ok: false, status: 409, code: 'TASKS_OUTSTANDING',
        error: `${tasks.length} task(s) are not done: ${naming(tasks)}. `
          + 'A task added after its milestone was met still has to be finished.',
      };
    }
    if (unaccepted.length) {
      return {
        ok: false, status: 409, code: 'DELIVERABLES_OUTSTANDING',
        error: `${unaccepted.length} deliverable(s) have not been accepted: ${naming(unaccepted)}. `
          + 'Uploading a file is not acceptance.',
      };
    }

    // Compare-and-swap on the status, so a double-click cannot stamp two closed_at values or emit
    // two events. `status <> 'closed'` rather than `= 'active'`: a project parked in 'closing' is
    // exactly the one someone is finishing.
    const [row] = await sql<{ status: string; closedAt: string | null }[]>`
      UPDATE projects
         SET status = 'closed', closed_at = now(), closed_by = ${actor.userId}::uuid,
             closeout_note = ${note},
             closeout_metrics = ${metrics === null ? null
               // `sql.json`, not `JSON.stringify(...)::jsonb` — the latter reads back as a string
               // and char-iterates. The cast is to postgres.js's JSONValue.
               : sql.json(metrics as Record<string, never>)},
             updated_at = now()
       WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND status <> 'closed'
      RETURNING status, closed_at`;
    if (!row) {
      return { ok: false, status: 409, code: 'ALREADY_CLOSED', error: 'That project is already closed out.' };
    }

    const [{ n: milestones }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM project_milestones
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;

    await emitEventSingle({
      namespace: 'project',
      type: 'project.closed',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, milestones, ...(note ? { note } : {}), ...(metrics ? { metrics } : {}) },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.closed',
      entityType: 'project', entityId: projectId, metadata: { milestones },
    });
    return { ok: true, data: { projectId, status: row.status, closedAt: row.closedAt, milestones } };
  } catch (err) {
    console.error('[projects/closeout] closeProject failed:', err);
    return { ok: false, status: 500, error: 'Failed to close out the project', code: 'DB_ERROR' };
  }
}

/** Reopen a closed project. Close-out reopens in the real world; the event pair is the history. */
export async function reopenProject(
  actor: ProjectActor,
  projectId: string,
  reason?: string | null,
): Promise<Ok<CloseoutResult> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can reopen a project', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  const why = (reason ?? '').trim() || null;
  try {
    const [row] = await sql<{ status: string; closedAt: string | null }[]>`
      UPDATE projects
         SET status = 'active', closed_at = NULL, closed_by = NULL, updated_at = now()
       WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid AND status = 'closed'
      RETURNING status, closed_at`;
    if (!row) {
      return { ok: false, status: 409, code: 'NOT_CLOSED', error: 'That project is not closed.' };
    }
    // The close-out note is KEPT. It described what happened when it was written, and deleting it
    // on reopen would erase the record the reopen is a correction to.
    await emitEventSingle({
      namespace: 'project',
      type: 'project.reopened',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, ...(why ? { reason: why } : {}) },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.reopened',
      entityType: 'project', entityId: projectId, metadata: { reason: why },
    });
    return { ok: true, data: { projectId, status: row.status, closedAt: null, milestones: 0 } };
  } catch (err) {
    console.error('[projects/closeout] reopenProject failed:', err);
    return { ok: false, status: 500, error: 'Failed to reopen the project', code: 'DB_ERROR' };
  }
}
