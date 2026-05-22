import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';

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
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { tenantSlug, proposalId, commentId } = await ctx.params;
    if (!isValidUUID(proposalId) || !isValidUUID(commentId)) {
      return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    // ── Verify proposal belongs to tenant ────────────────────────────
    const [proposal] = await sql<{ id: string }[]>`
      SELECT id FROM proposals
      WHERE id = ${proposalId}
        AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
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
      return NextResponse.json({ error: 'Comment not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Emit event ───────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'proposal',
      type: 'comment.resolved',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        commentId,
      },
    });

    // ── Activity log ────────────────────────────────────────────────
    try {
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role,
           activity_type, details)
        VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                ${sessionUser.email ?? null}, ${role},
                'comment_resolved',
                ${JSON.stringify({ comment_id: commentId })}::jsonb)
      `;
    } catch (logErr) {
      console.error('[api/portal/proposals/comments/resolve] activity log failed', logErr);
    }

    return NextResponse.json({
      data: { id: comment.id, resolved: true },
    });
  } catch (e) {
    console.error('[api/portal/proposals/comments/resolve] error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
