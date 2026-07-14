import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { resolveUserAccess } from '@/lib/proposal-access';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/comments
 *
 * Lists comments for this proposal. Optionally filter by ?nodeId=<uuid>
 * (mapped to section_id in the DB).
 * Auth: any tenant member.
 */
export async function GET(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
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
    let proposal: { id: string } | undefined;
    try {
      [proposal] = await sql<{ id: string }[]>`
        SELECT id FROM proposals
        WHERE id = ${proposalId}
          AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/comments] proposal query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Optional nodeId filter ───────────────────────────────────────
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId');
    if (nodeId && !isValidUUID(nodeId)) {
      return NextResponse.json({ error: 'Invalid nodeId format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let comments: {
      id: string;
      proposalId: string;
      sectionId: string | null;
      userId: string;
      content: string;
      resolved: boolean;
      createdAt: Date;
      recommendationType: string;
      category: string | null;
      userName: string | null;
      userEmail: string | null;
    }[];

    try {
    if (nodeId) {
      comments = await sql<typeof comments>`
        SELECT
          pc.id,
          pc.proposal_id,
          pc.section_id,
          pc.user_id,
          pc.content,
          pc.resolved,
          pc.created_at,
          pc.recommendation_type,
          pc.category,
          u.name AS user_name,
          u.email AS user_email
        FROM proposal_comments pc
        LEFT JOIN users u ON u.id = pc.user_id
        WHERE pc.proposal_id = ${proposalId}
          AND pc.section_id = ${nodeId}
        ORDER BY pc.created_at ASC
        LIMIT 200
      `;
    } else {
      comments = await sql<typeof comments>`
        SELECT
          pc.id,
          pc.proposal_id,
          pc.section_id,
          pc.user_id,
          pc.content,
          pc.resolved,
          pc.created_at,
          pc.recommendation_type,
          pc.category,
          u.name AS user_name,
          u.email AS user_email
        FROM proposal_comments pc
        LEFT JOIN users u ON u.id = pc.user_id
        WHERE pc.proposal_id = ${proposalId}
        ORDER BY pc.created_at ASC
        LIMIT 200
      `;
    }
    } catch (dbErr) {
      console.error('[api/portal/proposals/comments] comments query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({
      data: comments.map((c) => ({
        id: c.id,
        proposalId: c.proposalId,
        nodeId: c.sectionId,
        userId: c.userId,
        text: c.content,
        resolved: c.resolved,
        createdAt: c.createdAt,
        recommendationType: c.recommendationType,
        category: c.category,
        userName: c.userName,
        userEmail: c.userEmail,
      })),
    });
  } catch (e) {
    console.error('[api/portal/proposals/comments] GET error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/comments
 *
 * Adds a comment to a proposal node.
 * Body: { nodeId: string, text: string }
 * Auth: any tenant member.
 */
export async function POST(request: Request, ctx: RouteContext) {
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

    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
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

    // ── Input validation ─────────────────────────────────────────────
    let body: { nodeId?: unknown; text?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (typeof body.nodeId !== 'string' || !body.nodeId.trim()) {
      return NextResponse.json({ error: 'nodeId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (typeof body.text !== 'string' || !body.text.trim()) {
      return NextResponse.json({ error: 'text is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const nodeId = body.nodeId.trim();
    if (!isValidUUID(nodeId)) {
      return NextResponse.json({ error: 'Invalid nodeId format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const text = body.text.trim();

    if (text.length > 10000) {
      return NextResponse.json({ error: 'Comment too long (max 10000 characters)', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    // ── Verify proposal belongs to tenant ────────────────────────────
    let proposal2: { id: string } | undefined;
    try {
      [proposal2] = await sql<{ id: string }[]>`
        SELECT id FROM proposals
        WHERE id = ${proposalId}
          AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/comments] POST proposal query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal2) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Section must belong to this proposal ─────────────────────────
    let sectionOk: { id: string } | undefined;
    try {
      [sectionOk] = await sql<{ id: string }[]>`
        SELECT id FROM proposal_sections
        WHERE id = ${nodeId} AND proposal_id = ${proposalId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/comments] POST section check failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!sectionOk) {
      return NextResponse.json({ error: 'Section not found for this proposal', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Partner scoping: partners may only comment on granted sections ─
    // Tenant staff (tenant_user+) keep tenant-wide access.
    if (role === 'partner_user') {
      const access = await resolveUserAccess(sessionUser.id, proposalId, tenantId);
      const canComment =
        access.commentableSections.includes(nodeId) ||
        access.editableSections.includes(nodeId);
      if (!canComment) {
        return NextResponse.json({ error: 'No comment access to this section', code: 'FORBIDDEN' }, { status: 403 });
      }
    }

    // ── Insert comment ───────────────────────────────────────────────
    let comment: { id: string; createdAt: Date };
    try {
      [comment] = await sql<{ id: string; createdAt: Date }[]>`
        INSERT INTO proposal_comments (proposal_id, section_id, user_id, content)
        VALUES (${proposalId}, ${nodeId}, ${sessionUser.id}, ${text})
        RETURNING id, created_at
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/comments] POST insert failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ── Emit event ───────────────────────────────────────────────────
    try {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'comment.created',
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId,
        payload: {
          correlationId: randomUUID(),
          tenantId,
          tenantSlug,
          proposalId,
          commentId: comment.id,
          commentText: text.slice(0, 100),
          nodeId,
        },
      });
    } catch (e) {
      console.error('[api/portal/proposals/comments] event emission failed:', e);
    }

    // ── Activity log ────────────────────────────────────────────────
    try {
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role,
           activity_type, section_id, details)
        VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                ${sessionUser.email ?? null}, ${role},
                'comment_added', ${nodeId}::uuid,
                ${sql.json({ comment_id: comment.id, text: text.slice(0, 200) })})
      `;
    } catch (logErr) {
      console.error('[api/portal/proposals/comments] activity log failed', logErr);
    }

    return NextResponse.json({
      data: {
        id: comment.id,
        proposalId,
        nodeId,
        text,
        resolved: false,
        createdAt: comment.createdAt,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/comments] POST error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
