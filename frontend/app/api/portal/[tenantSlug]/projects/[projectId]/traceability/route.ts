/**
 * Contract traceability — CLIN → milestone → deliverable, and every gap in between.
 *
 * GET only. There is nothing to write: the map is a join over rows that already exist, and a
 * "fix it" button here would be a second writer on data the workspace already owns.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { traceability } from '@/lib/projects/traceability';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ data: await traceability(gate.actor.tenantId, projectId) });
    });
  } catch (err) {
    console.error('[api/portal/projects/traceability GET]', err);
    return NextResponse.json({ error: 'Failed to build the traceability map', code: 'DB_ERROR' }, { status: 500 });
  }
}
