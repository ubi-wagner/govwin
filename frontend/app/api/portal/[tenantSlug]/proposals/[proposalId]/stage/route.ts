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
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/stage
 *
 * Returns current stage, gate_config, lock status, and stage history.
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
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

    let proposal: {
      id: string;
      stage: string;
      gateConfig: string[];
      isLocked: boolean;
      lockCount: number;
      downloadCount: number;
      lastLockedAt: string | null;
      lastUnlockedAt: string | null;
      unlockDeadline: string | null;
    } | undefined;
    try {
      [proposal] = await sql<{
        id: string;
        stage: string;
        gateConfig: string[];
        isLocked: boolean;
        lockCount: number;
        downloadCount: number;
        lastLockedAt: string | null;
        lastUnlockedAt: string | null;
        unlockDeadline: string | null;
      }[]>`
        SELECT
          id, stage, gate_config, is_locked, lock_count,
          download_count, last_locked_at, last_unlocked_at, unlock_deadline
        FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/stage] GET proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Load stage history
    let history: {
      id: string;
      fromStage: string | null;
      toStage: string;
      changedBy: string;
      notes: string | null;
      createdAt: string;
    }[];
    try {
      history = await sql<typeof history>`
        SELECT id, from_stage, to_stage, changed_by, notes, created_at
        FROM proposal_stage_history
        WHERE proposal_id = ${proposalId}
        ORDER BY created_at ASC
      `;
    } catch (e) {
      console.error('[portal/proposals/stage] GET history query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        stage: proposal.stage,
        gateConfig: proposal.gateConfig || ['draft', 'final'],
        isLocked: proposal.isLocked,
        lockCount: proposal.lockCount,
        downloadCount: proposal.downloadCount,
        lastLockedAt: proposal.lastLockedAt,
        lastUnlockedAt: proposal.lastUnlockedAt,
        unlockDeadline: proposal.unlockDeadline,
        history,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/stage] GET error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/portal/[tenantSlug]/proposals/[proposalId]/stage
 *
 * Advance to the next gate in gate_config. Admin only.
 * Body: { notes?: string }
 */
export async function PATCH(request: Request, ctx: RouteContext) {
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

    let body: { notes?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      // No body is fine for advance
    }

    const notes = typeof body.notes === 'string' ? body.notes : null;

    let proposal: {
      id: string;
      stage: string;
      gateConfig: string[];
      title: string;
      lockCount: number;
      version: number;
    } | undefined;
    try {
      [proposal] = await sql<{
        id: string;
        stage: string;
        gateConfig: string[];
        title: string;
        lockCount: number;
        version: number;
      }[]>`
        SELECT id, stage, gate_config, title, lock_count, version
        FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/stage] PATCH proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const gates = (proposal.gateConfig || ['draft', 'final']) as string[];
    const currentIndex = gates.indexOf(proposal.stage);

    if (currentIndex === -1 || currentIndex >= gates.length - 1) {
      return NextResponse.json(
        { error: 'Already at the final gate, cannot advance further', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const previousStage = proposal.stage;
    const nextStage = gates[currentIndex + 1];
    const shouldLock = nextStage === 'final';
    // When advancing to 'final' AND auto-locking, also advance to 'submitted'
    const actualStage = shouldLock ? 'submitted' : nextStage;

    // Update proposal
    try {
      if (shouldLock) {
        const lockResult = await sql`
          UPDATE proposals
          SET stage = 'submitted',
              is_locked = true,
              lock_count = lock_count + 1,
              last_locked_at = now(),
              version = version + 1
          WHERE id = ${proposalId}
            AND tenant_id = ${tenantId}::uuid
            AND version = ${proposal.version}
        `;
        if (lockResult.count === 0) {
          return NextResponse.json(
            { error: 'Proposal was modified by another user', code: 'CONFLICT' },
            { status: 409 },
          );
        }
      } else {
        const updateResult = await sql`
          UPDATE proposals
          SET stage = ${nextStage},
              version = version + 1
          WHERE id = ${proposalId}
            AND tenant_id = ${tenantId}::uuid
            AND version = ${proposal.version}
        `;
        if (updateResult.count === 0) {
          return NextResponse.json(
            { error: 'Proposal was modified by another user', code: 'CONFLICT' },
            { status: 409 },
          );
        }
      }
    } catch (e) {
      console.error('[portal/proposals/stage] PATCH stage update failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Record stage history
    try {
      await sql`
        INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
        VALUES (${proposalId}, ${previousStage}, ${nextStage}, ${sessionUser.id}, ${notes})
      `;
      // If auto-locked at final, also record the auto-advance to 'submitted'
      if (shouldLock) {
        await sql`
          INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
          VALUES (${proposalId}, ${nextStage}, 'submitted', ${sessionUser.id}, 'Auto-advanced on lock')
        `;
      }
    } catch (e) {
      console.error('[portal/proposals/stage] PATCH stage history insert failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    await emitEventSingle({
      namespace: 'proposal',
      type: 'proposal.stage_advanced',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        proposalTitle: proposal.title,
        previousStage,
        nextStage: actualStage,
        locked: shouldLock,
        notes: notes ?? undefined,
      },
    });

    return NextResponse.json({
      data: {
        stage: actualStage,
        previousStage,
        locked: shouldLock,
        lockCount: shouldLock ? proposal.lockCount + 1 : proposal.lockCount,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/stage] PATCH error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
