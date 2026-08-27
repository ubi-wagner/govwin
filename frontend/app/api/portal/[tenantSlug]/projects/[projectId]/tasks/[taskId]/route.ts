/**
 * One task: tick it off, block it, reopen it — or rearrange it.
 *
 * **Open to any member who can reach the project**, not just a tenant_admin. Creating tasks and
 * closing the milestone are management acts; doing the work is not. A checklist only a manager can
 * tick is a status report they maintain on everyone else's behalf, which is the thing this feature
 * exists to replace — and the same argument applies to handing a task to whoever is free, or moving
 * it a week. A plan only a manager can rearrange goes stale between meetings.
 *
 * "Open" means visible, not untracked: every reassignment and every date change emits a
 * `project:task.reassigned` / `task.rescheduled` event carrying who moved what, from what, to what.
 *
 * TWO SHAPES, DELIBERATELY. A body with `status` is the checklist act and goes to `setTaskStatus`,
 * which compare-and-swaps. Anything else is an edit and goes to `updateTask`. Merging them would
 * mean a save that touched a note could also silently reopen finished work.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { setTaskStatus, updateTask } from '@/lib/projects/milestone-tasks';

interface Body {
  status?: string;
  blockedReason?: string | null;
  assigneeUserId?: string | null;
  assigneeRole?: string | null;
  dueDate?: string | null;
  estimatedCompletion?: string | null;
  detail?: string | null;
}

const EDITABLE = ['assigneeUserId', 'assigneeRole', 'dueDate', 'estimatedCompletion', 'detail'] as const;

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ tenantSlug: string; projectId: string; taskId: string }> },
) {
  try {
    const { tenantSlug, projectId, taskId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: Body;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      // `in`, not a truthiness check: `null` is a MEANING on every one of these fields — unassign,
      // clear the due date, drop the note — and `body.dueDate ? …` would read "clear it" as
      // "leave it alone", which is the quiet kind of wrong.
      const edits = EDITABLE.filter((k) => k in (body ?? {}));

      if (body?.status !== undefined) {
        if (edits.length) {
          return NextResponse.json({
            error: 'Send either a status change or an edit, not both — a note save must not be able '
              + 'to reopen finished work.',
            code: 'VALIDATION_ERROR',
          }, { status: 400 });
        }
        const next = body.status;
        if (next !== 'open' && next !== 'done' && next !== 'blocked') {
          return NextResponse.json(
            { error: "status must be 'open', 'done' or 'blocked'", code: 'VALIDATION_ERROR' },
            { status: 400 },
          );
        }
        const result = await setTaskStatus(gate.actor, projectId, taskId, next, body.blockedReason ?? null);
        if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
        return NextResponse.json({ data: { task: result.data } });
      }

      if (!edits.length) {
        return NextResponse.json({
          error: `Send a status, or one of: ${EDITABLE.join(', ')}`,
          code: 'VALIDATION_ERROR',
        }, { status: 400 });
      }

      const patch: Body = {};
      for (const k of edits) Object.assign(patch, { [k]: body[k] });
      const result = await updateTask(gate.actor, projectId, taskId, patch);
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { task: result.data } });
    });
  } catch (err) {
    console.error('[api/portal/projects/tasks/[taskId] PATCH]', err);
    return NextResponse.json({ error: 'Failed to update the task', code: 'DB_ERROR' }, { status: 500 });
  }
}
