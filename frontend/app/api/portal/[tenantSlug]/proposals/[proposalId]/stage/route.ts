import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { coerceJsonb } from '@/lib/jsonb';
import { advanceProposalStage } from '@/lib/proposal-advance';

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

    // Partner-containment: stage + gate + change-history is a proposal-wide read for tenant
    // members (tenant_user+). External collaborators (partner_user) pass verifyTenantAccess on
    // their membership, so a role floor is required so they can't read proposals they're not on.
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
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
    enterTenant(tenantId); // RLS choke point: pin tenant context in the handler's own frame

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
        gateConfig: coerceJsonb<string[]>(proposal.gateConfig, ['draft', 'final']),
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
 * Advance to the next gate. Delegates to the shared, GATED advanceProposalStage
 * core — identical to POST /advance (gate checks that every required section is
 * locked, snapshots, optimistic-lock CAS, stage history, events, AI-review
 * enqueue). Previously this handler bumped the stage directly and skipped the
 * lock gate, letting a direct call jump draft→final without accepting sections.
 * Body: { notes?: string, force?: boolean, targetStage?: string }
 */
export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as { id?: string; email?: string; role?: unknown; tenantId?: string | null };
    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
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
    enterTenant(tenantId); // RLS choke point: pin tenant context in the handler's own frame

    let body: { notes?: unknown; force?: boolean; targetStage?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      // No body is fine — auto-advance to the next gate.
    }
    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;

    const result = await advanceProposalStage({
      tenantId,
      tenantSlug,
      proposalId,
      actorId: sessionUser.id,
      actorEmail: sessionUser.email ?? null,
      actorRole: role,
      force: !!body.force,
      notes,
      targetStage: typeof body.targetStage === 'string' ? body.targetStage : undefined,
      trigger: 'manual',
    });

    if (!result.ok) {
      const payload: Record<string, unknown> = { error: result.error, code: result.code };
      if (result.details !== undefined) payload.details = result.details;
      return NextResponse.json(payload, { status: result.status });
    }
    return NextResponse.json({ data: result.data });
  } catch (e) {
    console.error('[api/portal/proposals/stage] PATCH error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
