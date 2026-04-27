import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; commentId: string }>;
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/comments/[commentId]/resolve
 *
 * Resolves a comment. Auth: any tenant member.
 */
export async function POST(_request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const { tenantSlug, proposalId, commentId } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied' }, { status: 403 });
    }

    // ── Verify proposal belongs to tenant ────────────────────────────
    const [proposal] = await sql<{ id: string }[]>`
      SELECT id FROM proposals
      WHERE id = ${proposalId}
        AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    // ── Resolve the comment ──────────────────────────────────────────
    const [comment] = await sql<{ id: string; resolved: boolean }[]>`
      UPDATE proposal_comments
      SET resolved = true
      WHERE id = ${commentId}
        AND proposal_id = ${proposalId}
      RETURNING id, resolved
    `;

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    // ── Emit event ───────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'capture',
      type: 'proposal.comment_resolved',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        proposalId,
        commentId,
      },
    });

    return NextResponse.json({
      data: { id: comment.id, resolved: true },
    });
  } catch (e) {
    console.error('[api/portal/proposals/comments/resolve] error:', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
