/**
 * Decide one review.
 *
 *   PATCH { decision: 'approved' }              — the named reviewer, or a tenant_admin.
 *   PATCH { decision: 'rejected', reason }      — same, and the reason is REQUIRED.
 *   PATCH { decision: 'withdrawn' }             — whoever asked, or a tenant_admin.
 *
 * A gate anyone can open is not a gate, which is why deciding is narrower than requesting. And a
 * request made in error must not be able to hold a deliverable hostage, which is what withdrawal
 * is for.
 *
 * There is no DELETE: a decided review is the record of who looked and what they said.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { decideReview } from '@/lib/projects/reviews';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string; reviewId: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId, reviewId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: { decision?: string; reason?: string | null };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const decision = body?.decision;
      if (decision !== 'approved' && decision !== 'rejected' && decision !== 'withdrawn') {
        return NextResponse.json(
          { error: "decision must be 'approved', 'rejected' or 'withdrawn'", code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }

      const result = await decideReview(gate.actor, projectId, reviewId, decision, body.reason ?? null);
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { review: result.data } });
    });
  } catch (err) {
    console.error('[api/portal/projects/reviews/[reviewId] PATCH]', err);
    return NextResponse.json({ error: 'Failed to record the decision', code: 'DB_ERROR' }, { status: 500 });
  }
}
