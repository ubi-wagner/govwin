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
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/advance
 *
 * Advances a proposal to the next gate in its configurable gate_config.
 * Replaces the old 7-stage Color Team pipeline.
 * Auth: tenant_admin or higher.
 *
 * Body: { targetStage?: string, notes?: string }
 * If targetStage is omitted, advances to the next gate automatically.
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

    // ── Input validation ─────────────────────────────────────────────
    let body: { targetStage?: unknown; notes?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      // No body is acceptable — will auto-advance to next gate
    }

    const notes = typeof body.notes === 'string' ? body.notes : null;

    // ── Load current proposal ────────────────────────────────────────
    const [proposal] = await sql<{
      id: string;
      stage: string;
      title: string;
      gateConfig: string[];
      lockCount: number;
      isLocked: boolean;
    }[]>`
      SELECT id, stage, title, gate_config, lock_count, is_locked FROM proposals
      WHERE id = ${proposalId}
        AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (proposal.isLocked) {
      return NextResponse.json({ error: 'Proposal is locked', code: 'LOCKED' }, { status: 409 });
    }

    // ── Determine next stage from gate_config ────────────────────────
    const gates = (proposal.gateConfig || ['draft', 'final']) as string[];
    const currentIndex = gates.indexOf(proposal.stage);

    if (currentIndex === -1) {
      return NextResponse.json(
        { error: `Current stage '${proposal.stage}' is not in gate config`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    if (currentIndex >= gates.length - 1) {
      return NextResponse.json(
        { error: 'Already at the final gate, cannot advance further', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const targetStage = typeof body.targetStage === 'string'
      ? body.targetStage
      : gates[currentIndex + 1];

    // Validate the target is the next gate
    const expectedNext = gates[currentIndex + 1];
    if (targetStage !== expectedNext) {
      return NextResponse.json(
        { error: `Cannot advance from '${proposal.stage}' to '${targetStage}'. Next gate is '${expectedNext}'.`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const previousStage = proposal.stage;
    const shouldLock = targetStage === 'final';

    // ── Update proposal stage (atomic: AND stage = previousStage prevents double-advance) ──
    if (shouldLock) {
      const advanceResult = await sql`
        UPDATE proposals
        SET stage = ${targetStage},
            is_locked = true,
            lock_count = lock_count + 1,
            last_locked_at = now()
        WHERE id = ${proposalId}
          AND stage = ${previousStage}
      `;
      if (advanceResult.count === 0) {
        return NextResponse.json({ error: 'Stage already changed', code: 'CONFLICT' }, { status: 409 });
      }
    } else {
      const advanceResult = await sql`
        UPDATE proposals
        SET stage = ${targetStage}
        WHERE id = ${proposalId}
          AND stage = ${previousStage}
      `;
      if (advanceResult.count === 0) {
        return NextResponse.json({ error: 'Stage already changed', code: 'CONFLICT' }, { status: 409 });
      }
    }

    // ── Record stage history ─────────────────────────────────────────
    await sql`
      INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
      VALUES (${proposalId}, ${previousStage}, ${targetStage}, ${sessionUser.id}, ${notes})
    `;

    // ── Emit event ───────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'proposal',
      type: 'proposal.advanced',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        proposalTitle: proposal.title,
        previousStage,
        targetStage,
        locked: shouldLock,
        lockCount: shouldLock ? proposal.lockCount + 1 : proposal.lockCount,
        notes: notes ?? undefined,
      },
    });

    return NextResponse.json({
      data: {
        stage: targetStage,
        previousStage,
        locked: shouldLock,
        lockCount: shouldLock ? proposal.lockCount + 1 : proposal.lockCount,
        ...(shouldLock ? { lockedAt: new Date().toISOString() } : {}),
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/advance] error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
