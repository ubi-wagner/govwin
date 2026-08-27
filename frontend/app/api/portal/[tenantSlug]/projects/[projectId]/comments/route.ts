/**
 * The conversation on a project.
 *
 *   GET   — every comment on the project, oldest first. One read: the workspace renders
 *           milestones, tasks and deliverables together, so a route per anchor would turn one page
 *           into thirty requests.
 *   POST  — say something. Open to anyone who can reach the project; a thread only a manager may
 *           start is a manager's notebook.
 *
 * `entityType` defaults to `project` — a comment about the whole thing. Anchoring it to a
 * milestone, task or deliverable also needs `entityId`, and that row is checked to belong to THIS
 * project before anything is written (there is no database FK; see migration 222).
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { listProjectComments, postComment } from '@/lib/projects/comments';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      const comments = await listProjectComments(gate.actor.tenantId, projectId);
      return NextResponse.json({ data: { comments } });
    });
  } catch (err) {
    console.error('[api/portal/projects/comments GET]', err);
    return NextResponse.json({ error: 'Failed to load the conversation', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: { entityType?: string; entityId?: string | null; parentId?: string | null; body?: string };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await postComment(gate.actor, projectId, {
        entityType: body?.entityType ?? 'project',
        entityId: body?.entityId ?? null,
        parentId: body?.parentId ?? null,
        body: body?.body ?? '',
      });
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });

      // `notified` and `unmatched` come back so the UI can say who was actually reached. A mention
      // feature that silently drops an unrecognised name lets the author believe they were heard.
      return NextResponse.json({ data: result.data }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/projects/comments POST]', err);
    return NextResponse.json({ error: 'Failed to post the comment', code: 'DB_ERROR' }, { status: 500 });
  }
}
