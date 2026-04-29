import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

const VALID_STAGES = [
  'outline',
  'draft',
  'pink_team',
  'red_team',
  'gold_team',
  'final',
  'submitted',
] as const;

type Stage = (typeof VALID_STAGES)[number];

/** Allowed forward transitions: current → next. */
const VALID_TRANSITIONS: Record<string, string> = {
  outline: 'draft',
  draft: 'pink_team',
  pink_team: 'red_team',
  red_team: 'gold_team',
  gold_team: 'final',
  final: 'submitted',
};

/** Stages that lock the workspace on entry. */
const LOCKING_STAGES: ReadonlySet<string> = new Set(['final', 'submitted']);

function isValidStage(s: unknown): s is Stage {
  return typeof s === 'string' && (VALID_STAGES as readonly string[]).includes(s);
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/advance
 *
 * Advances a proposal to the next stage in the Color Team pipeline.
 * Auth: tenant_admin or higher.
 *
 * Body: { targetStage: string, notes?: string }
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

    // Only tenant_admin or higher can advance stages
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
    let body: { targetStage?: unknown; notes?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (!isValidStage(body.targetStage)) {
      return NextResponse.json({ error: 'Invalid target stage', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const targetStage: Stage = body.targetStage;
    const notes = typeof body.notes === 'string' ? body.notes : null;

    // ── Load current proposal ────────────────────────────────────────
    const [proposal] = await sql<{ id: string; stage: string }[]>`
      SELECT id, stage FROM proposals
      WHERE id = ${proposalId}
        AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Validate transition ──────────────────────────────────────────
    const allowedNext = VALID_TRANSITIONS[proposal.stage];
    if (allowedNext !== targetStage) {
      return NextResponse.json(
        { error: `Cannot advance from '${proposal.stage}' to '${targetStage}'`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const previousStage = proposal.stage;
    const shouldLock = LOCKING_STAGES.has(targetStage);

    // ── Update proposal stage ────────────────────────────────────────
    if (shouldLock) {
      await sql`
        UPDATE proposals
        SET stage = ${targetStage},
            is_locked = true
        WHERE id = ${proposalId}
      `;
    } else {
      await sql`
        UPDATE proposals
        SET stage = ${targetStage}
        WHERE id = ${proposalId}
      `;
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
        proposalId,
        previousStage,
        targetStage,
        locked: shouldLock,
        notes: notes ?? undefined,
      },
    });

    return NextResponse.json({
      data: {
        stage: targetStage,
        previousStage,
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
