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

const VALID_OUTCOMES = ['awarded', 'rejected', 'withdrawn'] as const;
type Outcome = (typeof VALID_OUTCOMES)[number];

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/outcome
 *
 * Records a win/loss/withdrawn outcome for a proposal.
 *
 * When outcome = 'awarded':
 *   - All library_units harvested from this proposal get elevated:
 *     outcome_score = 1.0, confidence = 1.0, tagged 'winning_proposal'
 *   - These atoms will rank highest in future library searches
 *
 * When outcome = 'rejected':
 *   - Library_units get outcome_score = 0.3 (still usable but deprioritized)
 *
 * When outcome = 'withdrawn':
 *   - Library_units get outcome_score = 0.4 (neutral — content was valid, just not submitted)
 *
 * This creates the learning loop: atoms from winning proposals surface
 * first in future drafts, improving quality over time.
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    // ── Auth check ──────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    // Only tenant_admin+ can record outcomes
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Tenant verification ─────────────────────────────────────────
    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json(
        { error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Tenant access denied', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Parse + validate body ───────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    const outcome = body.outcome as string;
    if (!outcome || !VALID_OUTCOMES.includes(outcome as Outcome)) {
      return NextResponse.json(
        { error: `outcome must be one of: ${VALID_OUTCOMES.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;

    // ── Verify proposal exists and belongs to tenant ────────────────
    const [proposal] = await sql<Array<{
      id: string;
      stage: string;
      isLocked: boolean;
    }>>`
      SELECT id, stage, is_locked
      FROM proposals
      WHERE id = ${proposalId} AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Stage validation ───────────────────────────────────────────
    if (proposal.stage === 'archived') {
      return NextResponse.json(
        { error: 'Outcome already recorded', code: 'ALREADY_ARCHIVED' },
        { status: 409 },
      );
    }

    if (!['submitted', 'final', 'archived'].includes(proposal.stage)) {
      return NextResponse.json(
        { error: 'Outcome can only be recorded for submitted or final proposals', code: 'INVALID_STAGE' },
        { status: 422 },
      );
    }

    // ── Record outcome in a transaction ────────────────────────────
    // Wrap proposal archive + library_units update in transaction
    const atomsUpdated = await sql.begin(async (tx: any) => {
      // The proposals table doesn't have an 'outcome' column, so we
      // store it in the stage field (archive the proposal) and record
      // in stage_history with detailed notes.
      await tx`
        UPDATE proposals
        SET stage = 'archived',
            updated_at = now()
        WHERE id = ${proposalId}
      `;

      // Record in stage history with outcome details
      await tx`
        INSERT INTO proposal_stage_history
          (proposal_id, from_stage, to_stage, changed_by, notes)
        VALUES
          (${proposalId}, ${proposal.stage}, 'archived', ${sessionUser.id},
           ${`Outcome: ${outcome}${notes ? ' — ' + notes : ''}`})
      `;

      // ── Update library atoms based on outcome ───────────────────────
      let updated = 0;

      if (outcome === 'awarded') {
        // Elevate all library atoms harvested from this proposal
        const result = await tx`
          UPDATE library_units
          SET outcome = 'awarded',
              outcome_score = 1.0,
              confidence = 1.0,
              tags = array_append(
                array_remove(tags, 'winning_proposal'),
                'winning_proposal'
              )
          WHERE original_proposal_id = ${proposalId}::uuid
            AND tenant_id = ${tenantId}::uuid
        `;
        updated = result.count;
      } else if (outcome === 'rejected') {
        const result = await tx`
          UPDATE library_units
          SET outcome = 'rejected',
              outcome_score = 0.3
          WHERE original_proposal_id = ${proposalId}::uuid
            AND tenant_id = ${tenantId}::uuid
        `;
        updated = result.count;
      } else if (outcome === 'withdrawn') {
        const result = await tx`
          UPDATE library_units
          SET outcome = 'withdrawn',
              outcome_score = 0.4
          WHERE original_proposal_id = ${proposalId}::uuid
            AND tenant_id = ${tenantId}::uuid
        `;
        updated = result.count;
      }

      // Also record in library_atom_outcomes for audit trail
      // Map to the existing check constraint values
      const atomOutcomeValue = outcome === 'awarded' ? 'win' : outcome === 'rejected' ? 'loss' : 'pending';

      // Get all library unit IDs for this proposal
      const units = await tx<Array<{ id: string }>>`
        SELECT id FROM library_units
        WHERE original_proposal_id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
      `;

      for (const unit of units) {
        await tx`
          INSERT INTO library_atom_outcomes (unit_id, proposal_id, outcome)
          VALUES (${unit.id}, ${proposalId}::uuid, ${atomOutcomeValue})
          ON CONFLICT DO NOTHING
        `;
      }

      return updated;
    });

    // ── Emit event ──────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'proposal',
      type: 'outcome.recorded',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        outcome,
        notes,
        atomsUpdated,
      },
    });

    return NextResponse.json({
      data: {
        proposalId,
        outcome,
        atomsUpdated,
        stage: 'archived',
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/outcome] POST error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
