/**
 * Reviews on a project.
 *
 *   GET   — every review, newest first. One read: the workspace renders them beside the things
 *           they are about.
 *   POST  — ask somebody to look at a deliverable, a document or a milestone. Open to anyone on
 *           the project: asking a colleague to check something is collaboration, the same act as
 *           an @mention. DECIDING is narrower, and lives at `…/reviews/[reviewId]`.
 *
 * Approving is not accepting. A review gates the tenant_admin's acceptance; it does not perform it.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { listProjectReviews, requestReview } from '@/lib/projects/reviews';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      const reviews = await listProjectReviews(gate.actor.tenantId, projectId);
      return NextResponse.json({ data: { reviews } });
    });
  } catch (err) {
    console.error('[api/portal/projects/reviews GET]', err);
    return NextResponse.json({ error: 'Failed to load the reviews', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: {
        entityType?: string; entityId?: string;
        reviewerUserId?: string | null; reviewerRole?: string | null;
        note?: string | null; dueOn?: string | null;
      };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await requestReview(gate.actor, projectId, body ?? {});
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { review: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/projects/reviews POST]', err);
    return NextResponse.json({ error: 'Failed to request the review', code: 'DB_ERROR' }, { status: 500 });
  }
}
