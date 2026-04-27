import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }>;
}

const VALID_STATUSES = ['empty', 'ai_drafted', 'in_progress', 'complete', 'approved'] as const;

/**
 * PUT /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save
 *
 * Saves section content (JSON) and optionally updates status.
 * Auth: tenant member with edit access.
 *
 * Body: { content: object, status?: string }
 */
export async function PUT(request: Request, ctx: RouteContext) {
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

    const { tenantSlug, proposalId, sectionId } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied' }, { status: 403 });
    }

    // ── Input validation ─────────────────────────────────────────────
    let body: { content?: unknown; status?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (body.content === undefined || body.content === null) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    if (typeof body.content !== 'object') {
      return NextResponse.json({ error: 'content must be an object' }, { status: 400 });
    }

    const newStatus = typeof body.status === 'string' &&
      (VALID_STATUSES as readonly string[]).includes(body.status)
      ? body.status
      : null;

    // ── Verify proposal belongs to tenant and is not locked ─────────
    const [proposal] = await sql<{ id: string; isLocked: boolean }[]>`
      SELECT id, is_locked FROM proposals
      WHERE id = ${proposalId}
        AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 });
    }

    if (proposal.isLocked) {
      return NextResponse.json({ error: 'Proposal is locked' }, { status: 423 });
    }

    // ── Verify section belongs to this proposal ─────────────────────
    const [section] = await sql<{ id: string; version: number; status: string }[]>`
      SELECT id, version, status FROM proposal_sections
      WHERE id = ${sectionId}
        AND proposal_id = ${proposalId}
      LIMIT 1
    `;

    if (!section) {
      return NextResponse.json({ error: 'Section not found' }, { status: 404 });
    }

    // ── Update section ──────────────────────────────────────────────
    const contentJson = JSON.stringify(body.content);
    const nextVersion = section.version + 1;

    if (newStatus) {
      await sql`
        UPDATE proposal_sections
        SET content = ${contentJson},
            status = ${newStatus},
            version = ${nextVersion}
        WHERE id = ${sectionId}
      `;
    } else {
      await sql`
        UPDATE proposal_sections
        SET content = ${contentJson},
            version = ${nextVersion}
        WHERE id = ${sectionId}
      `;
    }

    // ── Emit event ───────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'capture',
      type: 'proposal.section.saved',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        proposalId,
        sectionId,
        version: nextVersion,
        status: newStatus ?? undefined,
      },
    });

    return NextResponse.json({
      data: {
        sectionId,
        version: nextVersion,
        status: newStatus ?? section.status,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/sections/save] error:', e);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
