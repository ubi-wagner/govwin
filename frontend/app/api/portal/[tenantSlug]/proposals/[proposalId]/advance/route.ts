import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';

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
    let body: { targetStage?: unknown; notes?: unknown; force?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      // No body is acceptable — will auto-advance to next gate
    }

    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;

    // ── Load current proposal ────────────────────────────────────────
    let proposal: {
      id: string;
      stage: string;
      title: string;
      gateConfig: string[];
      lockCount: number;
      isLocked: boolean;
      version: number;
    } | undefined;
    try {
      [proposal] = await sql<{
        id: string;
        stage: string;
        title: string;
        gateConfig: string[];
        lockCount: number;
        isLocked: boolean;
        version: number;
      }[]>`
        SELECT id, stage, title, gate_config, lock_count, is_locked, version FROM proposals
        WHERE id = ${proposalId}
          AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/advance] proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

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

    // ── Check gate requirements for current stage ───────────────────
    try {
      const unmetGates = await sql`
        SELECT label FROM stage_gate_requirements
        WHERE proposal_id = ${proposalId}::uuid AND stage = ${previousStage} AND is_met = false
      `;
      if (unmetGates.length > 0 && !body.force) {
        return NextResponse.json({
          error: 'Unmet gate requirements',
          code: 'GATE_REQUIREMENTS_NOT_MET',
          details: { unmet: unmetGates.map((g: Record<string, unknown>) => g.label) }
        }, { status: 422 });
      }
    } catch (e) {
      console.error('[advance] gate check failed:', e);
      // Non-fatal — proceed with advance if gate table doesn't exist
    }

    // ── Update proposal stage + record history (transactional) ──────
    try {
      await sql.begin(async (tx: any) => {
        if (shouldLock) {
          const advanceResult = await tx`
            UPDATE proposals
            SET stage = ${targetStage},
                is_locked = true,
                lock_count = lock_count + 1,
                last_locked_at = now(),
                version = version + 1,
                last_modified_by = ${sessionUser.id}::uuid
            WHERE id = ${proposalId}
              AND stage = ${previousStage}
              AND version = ${proposal.version}
          `;
          if (advanceResult.count === 0) {
            throw new Error('CONFLICT');
          }
        } else {
          const advanceResult = await tx`
            UPDATE proposals
            SET stage = ${targetStage},
                version = version + 1,
                last_modified_by = ${sessionUser.id}::uuid
            WHERE id = ${proposalId}
              AND stage = ${previousStage}
              AND version = ${proposal.version}
          `;
          if (advanceResult.count === 0) {
            throw new Error('CONFLICT');
          }
        }

        await tx`
          INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
          VALUES (${proposalId}, ${previousStage}, ${targetStage}, ${sessionUser.id}, ${notes})
        `;
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'CONFLICT') {
        return NextResponse.json({ error: 'Stage already changed', code: 'CONFLICT' }, { status: 409 });
      }
      console.error('[portal/proposals/advance] stage update failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

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

    // ── Activity log ────────────────────────────────────────────────
    try {
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role,
           activity_type, entity_version, details)
        VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                ${sessionUser.email ?? null}, ${role},
                'stage_advanced', ${proposal.version + 1},
                ${JSON.stringify({ from_stage: previousStage, to_stage: targetStage, notes: notes ?? undefined })}::jsonb)
      `;
    } catch (logErr) {
      console.error('[api/portal/proposals/advance] activity log failed', logErr);
    }

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
