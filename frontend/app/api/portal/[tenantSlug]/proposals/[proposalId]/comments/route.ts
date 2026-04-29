import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';

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

    // ── Optional nodeId filter ───────────────────────────────────────
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('nodeId');

    let comments: {
      id: string;
      proposalId: string;
      sectionId: string | null;
      userId: string;
      content: string;
      resolved: boolean;
      createdAt: Date;
      userName: string | null;
      userEmail: string | null;
    }[];

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
          u.name AS user_name,
          u.email AS user_email
        FROM proposal_comments pc
        LEFT JOIN users u ON u.id = pc.user_id
        WHERE pc.proposal_id = ${proposalId}
          AND pc.section_id = ${nodeId}
        ORDER BY pc.created_at ASC
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
          u.name AS user_name,
          u.email AS user_email
        FROM proposal_comments pc
        LEFT JOIN users u ON u.id = pc.user_id
        WHERE pc.proposal_id = ${proposalId}
        ORDER BY pc.created_at ASC
      `;
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
    const text = body.text.trim();

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

    // ── Insert comment ───────────────────────────────────────────────
    const [comment] = await sql<{ id: string; createdAt: Date }[]>`
      INSERT INTO proposal_comments (proposal_id, section_id, user_id, content)
      VALUES (${proposalId}, ${nodeId}, ${sessionUser.id}, ${text})
      RETURNING id, created_at
    `;

    // ── Emit event ───────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'proposal',
      type: 'comment.created',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        proposalId,
        commentId: comment.id,
        nodeId,
      },
    });

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
