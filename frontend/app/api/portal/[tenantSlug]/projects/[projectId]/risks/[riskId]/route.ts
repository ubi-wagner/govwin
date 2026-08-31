/**
 * One risk.
 *
 *   PATCH { action: 'raise_issue' }   — it happened. Moves `kind` IN PLACE, keeping the score it
 *                                        was rated at and the moment we learned. Anyone on the project.
 *   PATCH { action: 'close', note }   — `tenant_admin`: deciding a risk is behind us is a call.
 *   PATCH { action: 'mitigate', … }   — turn the mitigation into a real project task, so it
 *                                        inherits the ToDo, the email and the nudges rather than
 *                                        becoming a second checklist.
 *   PATCH { probability, impact, … }  — rescore or edit. Anyone on the project.
 *
 * No DELETE. A register you can delete from cannot answer "when did we know".
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { updateRisk, raiseAsIssue, closeRisk, mitigationTask } from '@/lib/projects/risks';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string; riskId: string }> };

const EDITABLE = ['probability', 'impact', 'ownerUserId', 'mitigation', 'contingency', 'reviewOn', 'detail'] as const;

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId, riskId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: Record<string, unknown>;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (body?.action === 'raise_issue') {
        const r = await raiseAsIssue(gate.actor, projectId, riskId);
        if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
        return NextResponse.json({ data: { risk: r.data } });
      }
      if (body?.action === 'close') {
        const r = await closeRisk(gate.actor, projectId, riskId, (body.note as string) ?? null);
        if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
        return NextResponse.json({ data: { risk: r.data } });
      }
      if (body?.action === 'mitigate') {
        const r = await mitigationTask(gate.actor, projectId, riskId, {
          title: (body.title as string) ?? undefined,
          assigneeUserId: (body.assigneeUserId as string) ?? null,
          dueDate: (body.dueDate as string) ?? null,
        });
        if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
        return NextResponse.json({ data: r.data }, { status: 201 });
      }

      // `in`, not truthiness: null MEANS clear the owner or the review date.
      const edits = EDITABLE.filter((k) => k in body);
      if (!edits.length) {
        return NextResponse.json({
          error: `Send action:'raise_issue' | 'close' | 'mitigate', or one of: ${EDITABLE.join(', ')}`,
          code: 'VALIDATION_ERROR',
        }, { status: 400 });
      }
      const patch: Record<string, unknown> = {};
      for (const k of edits) patch[k] = body[k];
      const r = await updateRisk(gate.actor, projectId, riskId, patch);
      if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
      return NextResponse.json({ data: { risk: r.data } });
    });
  } catch (err) {
    console.error('[api/portal/projects/risks/[riskId] PATCH]', err);
    return NextResponse.json({ error: 'Failed to update it', code: 'DB_ERROR' }, { status: 500 });
  }
}
