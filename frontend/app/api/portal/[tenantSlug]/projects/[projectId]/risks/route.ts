/**
 * The risk and issue register.
 *
 *   GET   — every risk and issue, open ones first, worst score first. A register sorted by date is
 *           one nobody reads past row three.
 *   POST  — raise one. Open to anyone on the project: the person who sees a risk first is rarely
 *           the manager, and a register only a manager may write lags reality by a week.
 *           `asIssue: true` logs something that has already happened.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { listProjectRisks, raiseRisk } from '@/lib/projects/risks';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ data: { risks: await listProjectRisks(gate.actor.tenantId, projectId) } });
    });
  } catch (err) {
    console.error('[api/portal/projects/risks GET]', err);
    return NextResponse.json({ error: 'Failed to load the register', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: Record<string, unknown>;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await raiseRisk(gate.actor, projectId, {
        title: body.title as string,
        detail: (body.detail as string) ?? null,
        milestoneId: (body.milestoneId as string) ?? null,
        probability: body.probability as number,
        impact: body.impact as number,
        ownerUserId: (body.ownerUserId as string) ?? null,
        mitigation: (body.mitigation as string) ?? null,
        contingency: (body.contingency as string) ?? null,
        reviewOn: (body.reviewOn as string) ?? null,
        asIssue: body.asIssue === true,
      });
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { risk: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/projects/risks POST]', err);
    return NextResponse.json({ error: 'Failed to raise it', code: 'DB_ERROR' }, { status: 500 });
  }
}
