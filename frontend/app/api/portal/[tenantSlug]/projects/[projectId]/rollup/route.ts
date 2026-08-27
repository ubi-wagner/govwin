/**
 * Progress — three measures, side by side, never blended.
 *
 * There is no `percentComplete` in this response and there is not going to be one. Sixty percent of
 * budget against forty percent of schedule is the most useful thing a PM can see, and averaging
 * them to "50%" destroys exactly that signal while still looking like an answer.
 *
 * A measure with no denominator comes back `null`, not `0` — "not measured" and "measured, and it
 * is zero" are different facts, and a project with nothing planned is not 0% spent.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { rollup } from '@/lib/projects/rollup';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {

      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ data: await rollup(gate.actor.tenantId, projectId) });
    });
  } catch (err) {
    console.error('[api/portal/projects/rollup GET]', err);
    return NextResponse.json({ error: 'Failed to compute progress', code: 'DB_ERROR' }, { status: 500 });
  }
}
