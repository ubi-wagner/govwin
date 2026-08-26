/**
 * Milestones on a delivery project.
 *
 *   GET   — milestones plus their deliverables, so the page renders in one round trip.
 *   POST  — add a milestone. tenant_admin+.
 *   PATCH — mark one met. Refuses while a deliverable on it is unaccepted: uploading a file is
 *           not acceptance, and a milestone whose evidence nobody approved is not met.
 */
import { NextResponse } from 'next/server';
import { deliveryGate } from '@/lib/delivery/gate';
import { getProject } from '@/lib/delivery/projects';
import { createMilestone, listMilestones, listDeliverables, markMilestoneMet } from '@/lib/delivery/milestones';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    const gate = await deliveryGate(tenantSlug);
    if ('error' in gate) return gate.error;

    if (!(await getProject(gate.actor, projectId))) {
      return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const [milestones, deliverables] = await Promise.all([
      listMilestones(gate.actor.tenantId, projectId),
      listDeliverables(gate.actor.tenantId, projectId),
    ]);
    return NextResponse.json({ data: { milestones, deliverables } });
  } catch (err) {
    console.error('[api/portal/delivery/milestones GET]', err);
    return NextResponse.json({ error: 'Failed to load milestones', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    const gate = await deliveryGate(tenantSlug);
    if ('error' in gate) return gate.error;

    let body: { title?: string; clinId?: string | null; wbsNodeId?: string | null; forecastDate?: string | null; sortIndex?: number };
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    const result = await createMilestone(gate.actor, projectId, { title: body?.title ?? '', ...body });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ data: { milestone: result.data } }, { status: 201 });
  } catch (err) {
    console.error('[api/portal/delivery/milestones POST]', err);
    return NextResponse.json({ error: 'Failed to add the milestone', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    const gate = await deliveryGate(tenantSlug);
    if ('error' in gate) return gate.error;

    let body: { milestoneId?: string; action?: string };
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    if (body?.action !== 'met' || !body?.milestoneId) {
      return NextResponse.json(
        { error: "Provide milestoneId and action:'met'", code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const result = await markMilestoneMet(gate.actor, projectId, body.milestoneId);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ data: { milestone: result.data } });
  } catch (err) {
    console.error('[api/portal/delivery/milestones PATCH]', err);
    return NextResponse.json({ error: 'Failed to close the milestone', code: 'DB_ERROR' }, { status: 500 });
  }
}
