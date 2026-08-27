/**
 * The task list under a project's milestones.
 *
 *   GET   — every task on the project, milestone order. Also served inline by the milestones GET;
 *           this exists so a client can refresh the checklist without re-fetching the whole plan.
 *   POST  — add a task. tenant_admin+ — assigning work is a management act.
 *
 * `milestoneId` is OPTIONAL (mig 221). Omit it for standing project work: the scope is DERIVED from
 * whether one was named, never sent separately, because two inputs that must agree eventually will
 * not. Editing an existing task — owner, dates, note — is open to anyone on the project and lives
 * at `…/tasks/[taskId]`.
 *
 * Ticking one off lives at `…/tasks/[taskId]` and is open to any assigned member, because doing the
 * work is not a management act and a checklist only one person may touch is not a checklist.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { createMilestoneTask, listMilestoneTasks } from '@/lib/projects/milestone-tasks';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ data: { tasks: await listMilestoneTasks(gate.actor.tenantId, projectId) } });
    });
  } catch (err) {
    console.error('[api/portal/projects/tasks GET]', err);
    return NextResponse.json({ error: 'Failed to load the task list', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: {
        milestoneId?: string | null; title?: string; detail?: string | null;
        assigneeUserId?: string | null; assigneeRole?: string | null;
        dueDate?: string | null; estimatedCompletion?: string | null; sortIndex?: number;
      };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await createMilestoneTask(gate.actor, projectId, {
        // No `milestoneId` means standing project work — not a missing field. The domain layer
        // derives `scope` from it.
        milestoneId: body.milestoneId ?? null,
        title: body.title ?? '',
        detail: body.detail ?? null,
        assigneeUserId: body.assigneeUserId ?? null,
        assigneeRole: body.assigneeRole ?? null,
        dueDate: body.dueDate ?? null,
        estimatedCompletion: body.estimatedCompletion ?? null,
        sortIndex: body.sortIndex,
      });
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { task: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/projects/tasks POST]', err);
    return NextResponse.json({ error: 'Failed to add the task', code: 'DB_ERROR' }, { status: 500 });
  }
}
