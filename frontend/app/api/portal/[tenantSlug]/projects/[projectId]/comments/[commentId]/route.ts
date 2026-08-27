/**
 * One comment: resolve it, reopen it, or edit your own words.
 *
 *   PATCH { action: 'resolve' | 'reopen' }  — open to anyone on the project. A thread only a
 *          manager may close is a manager's notebook. Resolving closes the mention ToDos standing
 *          against it, so a finished conversation leaves nothing in anyone's queue.
 *   PATCH { body }                          — the AUTHOR only, stamping `edited_at`. Rewriting
 *          somebody else's comment is a different act, and one this product has no reason to allow.
 *
 * There is no DELETE. A resolved thread stays readable — nothing here is hard-deleted
 * (docs/ARCHIVABLE_CONTRACT.md), and a conversation with holes in it is worse than none.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { setCommentResolved, editComment } from '@/lib/projects/comments';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string; commentId: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId, commentId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: { action?: string; body?: string };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (body?.action === 'resolve' || body?.action === 'reopen') {
        const result = await setCommentResolved(gate.actor, projectId, commentId, body.action === 'resolve');
        if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
        return NextResponse.json({ data: { comment: result.data } });
      }

      if (typeof body?.body === 'string') {
        const result = await editComment(gate.actor, projectId, commentId, body.body);
        if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
        return NextResponse.json({ data: result.data });
      }

      return NextResponse.json(
        { error: "Send action:'resolve' | 'reopen', or a new body", code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    });
  } catch (err) {
    console.error('[api/portal/projects/comments/[commentId] PATCH]', err);
    return NextResponse.json({ error: 'Failed to update the comment', code: 'DB_ERROR' }, { status: 500 });
  }
}
