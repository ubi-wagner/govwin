import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, isMasterAdmin } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/lock
 *
 * Locks the proposal workspace with business rules:
 * - Can only lock at final stage
 * - lock_count 1: first lock, downloads enabled
 * - lock_count 2: second lock after self-service unlock
 * - lock_count > 2: rejected, requires master_admin
 */
export async function POST(_request: Request, ctx: RouteContext) {
  try {
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

    const [proposal] = await sql<{
      id: string;
      isLocked: boolean;
      stage: string;
      lockCount: number;
    }[]>`
      SELECT id, is_locked, stage, lock_count FROM proposals
      WHERE id = ${proposalId} AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (proposal.isLocked) {
      return NextResponse.json({ error: 'Workspace is already locked', code: 'VALIDATION_ERROR' }, { status: 409 });
    }

    // Business rule: can only lock at final stage
    if (proposal.stage !== 'final') {
      return NextResponse.json(
        { error: 'Can only lock at final stage', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // Business rule: after second lock, only master_admin can lock again
    if (proposal.lockCount >= 2 && !isMasterAdmin(role)) {
      return NextResponse.json(
        { error: 'Further locks require master admin. Contact RFP Pipeline support.', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // Lock the proposal
    const newLockCount = proposal.lockCount + 1;
    await sql`
      UPDATE proposals
      SET is_locked = true,
          lock_count = ${newLockCount},
          last_locked_at = now(),
          unlock_deadline = NULL
      WHERE id = ${proposalId}
    `;

    await emitEventSingle({
      namespace: 'proposal',
      type: 'proposal.locked',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        lockCount: newLockCount,
      },
    });

    return NextResponse.json({
      data: {
        locked: true,
        lockCount: newLockCount,
        lockedAt: new Date().toISOString(),
        downloadAvailable: true,
      },
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
 * Unlocks the proposal workspace with business rules:
 * - lock_count 0: nothing to unlock
 * - lock_count 1: self-service unlock, sets 7-day deadline
 * - lock_count >= 2: only master_admin can unlock
 */
export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
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

    const [proposal] = await sql<{
      id: string;
      isLocked: boolean;
      lockCount: number;
    }[]>`
      SELECT id, is_locked, lock_count FROM proposals
      WHERE id = ${proposalId} AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (!proposal.isLocked) {
      return NextResponse.json({ error: 'Workspace is not locked', code: 'VALIDATION_ERROR' }, { status: 409 });
    }

    if (proposal.lockCount === 0) {
      return NextResponse.json({ error: 'Nothing to unlock', code: 'VALIDATION_ERROR' }, { status: 409 });
    }

    // Business rule: after second lock, only master_admin can unlock
    if (proposal.lockCount >= 2 && !isMasterAdmin(role)) {
      return NextResponse.json(
        { error: 'Further unlocks require master admin. Contact RFP Pipeline support.', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // Self-service unlock: set 7-day edit window
    const unlockDeadline = new Date();
    unlockDeadline.setDate(unlockDeadline.getDate() + 7);

    await sql`
      UPDATE proposals
      SET is_locked = false,
          last_unlocked_at = now(),
          unlock_deadline = ${proposal.lockCount === 1 ? unlockDeadline.toISOString() : null}
      WHERE id = ${proposalId}
    `;

    await emitEventSingle({
      namespace: 'proposal',
      type: 'proposal.unlocked',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        lockCount: proposal.lockCount,
        unlockDeadline: proposal.lockCount === 1 ? unlockDeadline.toISOString() : null,
      },
    });

    return NextResponse.json({
      data: {
        locked: false,
        lockCount: proposal.lockCount,
        unlockDeadline: proposal.lockCount === 1 ? unlockDeadline.toISOString() : null,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/lock] DELETE error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
