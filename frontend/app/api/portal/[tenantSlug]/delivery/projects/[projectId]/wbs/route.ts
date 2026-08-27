/**
 * The work breakdown structure.
 *
 *   GET  — the nodes, in `sort_index` order, plus the same rows projected onto a `workplan` canvas
 *          so the grid editor can render them without a second round trip.
 *   POST — add a task. tenant_admin+.
 *
 * The rows are the plan; the canvas is a rendering of them, regenerated on every load. There is no
 * second copy to drift.
 */
import { NextResponse } from 'next/server';
import { withDelivery } from '@/lib/delivery/gate';
import { getProject } from '@/lib/delivery/projects';
import { listClins } from '@/lib/delivery/clins';
import { createWbsNode, listWbs, toWorkplanCanvas, type WbsInput } from '@/lib/delivery/wbs';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withDelivery(tenantSlug, async (gate) => {

      const project = await getProject(gate.actor, projectId);
      if (!project) return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });

      const [nodes, clins] = await Promise.all([
        listWbs(gate.actor.tenantId, projectId),
        listClins(gate.actor.tenantId, projectId),
      ]);
      const canvas = toWorkplanCanvas(nodes, clins, project.name);

      return NextResponse.json({ data: { nodes, canvas } });
    });
  } catch (err) {
    console.error('[api/portal/delivery/wbs GET]', err);
    return NextResponse.json({ error: 'Failed to load the work breakdown', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withDelivery(tenantSlug, async (gate) => {

      let body: WbsInput;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await createWbsNode(gate.actor, projectId, body ?? ({} as WbsInput));
      if (!result.ok) {
        return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      }
      return NextResponse.json({ data: { node: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/delivery/wbs POST]', err);
    return NextResponse.json({ error: 'Failed to add the task', code: 'DB_ERROR' }, { status: 500 });
  }
}
