import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/lock
 *
 * Locks the proposal workspace. Auth: tenant_admin or higher.
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

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
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
    const [proposal] = await sql<{ id: string; isLocked: boolean }[]>`
      SELECT id, is_locked FROM proposals
      WHERE id = ${proposalId}
        AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (proposal.isLocked) {
      return NextResponse.json({ error: 'Workspace is already locked', code: 'VALIDATION_ERROR' }, { status: 409 });
    }

    // ── Lock ─────────────────────────────────────────────────────────
    await sql`
      UPDATE proposals
      SET is_locked = true
      WHERE id = ${proposalId}
    `;

    // ── Emit event ───────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'proposal',
      type: 'proposal.locked',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: { correlationId: randomUUID(), proposalId },
    });

    return NextResponse.json({
      data: { locked: true, lockedAt: new Date().toISOString() },
    });
  } catch (e) {
    console.error('[api/portal/proposals/lock] POST error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/portal/[tenantSlug]/proposals/[proposalId]/lock
 *
 * Unlocks the proposal workspace. Auth: tenant_admin or higher.
 */
export async function DELETE(_request: Request, ctx: RouteContext) {
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

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
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
    const [proposal] = await sql<{ id: string; isLocked: boolean }[]>`
      SELECT id, is_locked FROM proposals
      WHERE id = ${proposalId}
        AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (!proposal.isLocked) {
      return NextResponse.json({ error: 'Workspace is not locked', code: 'VALIDATION_ERROR' }, { status: 409 });
    }

    // ── Unlock ───────────────────────────────────────────────────────
    await sql`
      UPDATE proposals
      SET is_locked = false
      WHERE id = ${proposalId}
    `;

    // ── Emit event ───────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'proposal',
      type: 'proposal.unlocked',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: { correlationId: randomUUID(), proposalId },
    });

    return NextResponse.json({
      data: { locked: false },
    });
  } catch (e) {
    console.error('[api/portal/proposals/lock] DELETE error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
