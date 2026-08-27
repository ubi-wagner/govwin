/**
 * Deliverables — the things a milestone is met BY.
 *
 *   GET  — every deliverable on the project.
 *   POST — declare one (title, required-by). Declaring is not uploading; uploading is not
 *          acceptance. Three separate acts, on purpose.
 */
import { NextResponse } from 'next/server';
import { withDelivery } from '@/lib/delivery/gate';
import { getProject } from '@/lib/delivery/projects';
import { createDeliverable, listDeliverables } from '@/lib/delivery/milestones';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withDelivery(tenantSlug, async (gate) => {

      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ data: { deliverables: await listDeliverables(gate.actor.tenantId, projectId) } });
    });
  } catch (err) {
    console.error('[api/portal/delivery/deliverables GET]', err);
    return NextResponse.json({ error: 'Failed to load deliverables', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withDelivery(tenantSlug, async (gate) => {

      let body: { milestoneId?: string; title?: string; requiredBy?: string | null; sortIndex?: number };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (!body?.milestoneId) {
        return NextResponse.json({ error: 'milestoneId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const result = await createDeliverable(gate.actor, projectId, {
        milestoneId: body.milestoneId, title: body.title ?? '', requiredBy: body.requiredBy ?? null,
        sortIndex: body.sortIndex,
      });
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { deliverable: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/delivery/deliverables POST]', err);
    return NextResponse.json({ error: 'Failed to add the deliverable', code: 'DB_ERROR' }, { status: 500 });
  }
}
