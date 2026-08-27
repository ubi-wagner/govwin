/**
 * Freezing the plan, and moving it afterwards.
 *
 *   GET   — whether the skeleton can be frozen yet, and the current variance per milestone.
 *   POST  — set the baseline. Once. Refuses if the anchor documents are not both present.
 *   PATCH — rebaseline: shift the CURRENT plan. The baseline is never touched, which is why this
 *           is a different verb and not an argument to the one above.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject, readiness } from '@/lib/projects/project';
import { setBaseline, rebaseline, milestoneVariance, type RebaselineInput } from '@/lib/projects/baseline';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {

      const project = await getProject(gate.actor, projectId);
      if (!project) return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });

      const [ready, variance] = await Promise.all([
        readiness(gate.actor.tenantId, projectId),
        milestoneVariance(gate.actor.tenantId, projectId),
      ]);
      return NextResponse.json({
        data: { baselinedAt: project.baselinedAt, readiness: ready, variance },
      });
    });
  } catch (err) {
    console.error('[api/portal/projects/baseline GET]', err);
    return NextResponse.json({ error: 'Failed to read the baseline', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {

      const result = await setBaseline(gate.actor, projectId);
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { baseline: result.data } });
    });
  } catch (err) {
    console.error('[api/portal/projects/baseline POST]', err);
    return NextResponse.json({ error: 'Failed to set the baseline', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {

      let body: RebaselineInput;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await rebaseline(gate.actor, projectId, body ?? ({} as RebaselineInput));
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { rebaseline: result.data } });
    });
  } catch (err) {
    console.error('[api/portal/projects/baseline PATCH]', err);
    return NextResponse.json({ error: 'Failed to rebaseline', code: 'DB_ERROR' }, { status: 500 });
  }
}
