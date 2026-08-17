import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';
import { launchProjectCollaboration } from '@/lib/process/project-collaboration';
import { resolveGatePolicy } from '@/lib/automation/policy';
import { coerceOriginCard } from '@/lib/cards/card';
import { completeOutcomeTodos } from '@/lib/proposal/outcome-todo';

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
 *   - All library_atoms harvested from this proposal (origin_proposal_id) get
 *     elevated: outcome_score = 1.0, confidence = 1.0
 *   - These atoms will rank highest in future library selection
 *
 * When outcome = 'rejected':
 *   - library_atoms get outcome_score = 0.3 (still usable but deprioritized)
 *
 * When outcome = 'withdrawn':
 *   - library_atoms get outcome_score = 0.4 (neutral — content was valid, just not submitted)
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

    enterTenant(tenantId);

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
    let proposal:
      | { id: string; stage: string; isLocked: boolean; version: number; title: string; opportunityId: string; originCard: unknown }
      | undefined;
    try {
      [proposal] = await sql<Array<{
        id: string;
        stage: string;
        isLocked: boolean;
        version: number;
        title: string;
        opportunityId: string;
        originCard: unknown;
      }>>`
        SELECT id, stage, is_locked, version, title, opportunity_id, origin_card
        FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/outcome] proposal query failed:', dbErr);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

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

    if (!['submitted', 'final'].includes(proposal.stage)) {
      return NextResponse.json(
        { error: 'Outcome can only be recorded for submitted or final proposals', code: 'INVALID_STAGE' },
        { status: 422 },
      );
    }

    // ── Start event for outcome recording ──────────────────────────
    const startId = await emitEventStart({
      namespace: 'proposal',
      type: 'outcome.recorded',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: { proposalId, outcome, notes },
    });

    // ── Record outcome in a transaction ────────────────────────────
    // Wrap proposal archive + library_atoms outcome update in transaction
    let atomsUpdated: number;
    try {
    atomsUpdated = await withTenant(tenantId, async (tx: any) => {
      // Scope this transaction to the tenant so the FORCE-RLS library_atoms writes
      // below pass the per-tenant policy (mirrors withTenant). Harmless for the
      // proposals/stage-history writes under the current owner connection.
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      // The proposals table doesn't have an 'outcome' column, so we
      // store it in the stage field (archive the proposal) and record
      // in stage_history with detailed notes.
      // OCC: only update if version matches what we read
      const updateResult = await tx`
        UPDATE proposals
        SET stage = 'archived',
            archived_at = now(),
            version = version + 1,
            updated_at = now()
        WHERE id = ${proposalId}
          AND tenant_id = ${tenantId}::uuid
          AND version = ${proposal.version}
      `;

      if (updateResult.count === 0) {
        throw new Error('CONFLICT');
      }

      // Archiving the proposal cascades its BUILD workflow instances (ARCHIVABLE_CONTRACT). Scope to the
      // build spine — never a co-active discovery ('spotlight') or the awarded-path 'contract' kickoff
      // (which, for outcome='awarded', is launched AFTER this transaction on the same opportunity).
      if (proposal.opportunityId) {
        await tx`
          UPDATE process_instances SET archived_at = now()
          WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${proposal.opportunityId}::uuid AND archived_at IS NULL
            AND (scope IS NULL OR scope NOT IN ('spotlight', 'contract'))
        `;
      }

      // Record in stage history with outcome details
      await tx`
        INSERT INTO proposal_stage_history
          (proposal_id, from_stage, to_stage, changed_by, notes)
        VALUES
          (${proposalId}, ${proposal.stage}, 'archived', ${sessionUser.id},
           ${`Outcome: ${outcome}${notes ? ' — ' + notes : ''}`})
      `;

      // ── Update library atoms based on outcome ───────────────────────
      // Elevate/deprioritize the derivative atoms harvested from this proposal,
      // matched by origin_proposal_id. outcome_score drives future selection
      // ranking (selectForSection). library_atoms has no `tags` column, so the
      // 'winning_proposal' tag the legacy library_units path appended is dropped —
      // outcome_score = 1.0 is what actually surfaces winners.
      let updated = 0;

      if (outcome === 'awarded') {
        const result = await tx`
          UPDATE library_atoms
          SET outcome = 'awarded',
              outcome_score = 1.0,
              confidence = 1.0
          WHERE origin_proposal_id = ${proposalId}::uuid
            AND tenant_id = ${tenantId}::uuid
        `;
        updated = result.count;
      } else if (outcome === 'rejected') {
        const result = await tx`
          UPDATE library_atoms
          SET outcome = 'rejected',
              outcome_score = 0.3
          WHERE origin_proposal_id = ${proposalId}::uuid
            AND tenant_id = ${tenantId}::uuid
        `;
        updated = result.count;
      } else if (outcome === 'withdrawn') {
        const result = await tx`
          UPDATE library_atoms
          SET outcome = 'withdrawn',
              outcome_score = 0.4
          WHERE origin_proposal_id = ${proposalId}::uuid
            AND tenant_id = ${tenantId}::uuid
        `;
        updated = result.count;
      }

      // NOTE: the legacy library_atom_outcomes audit-trail INSERT (a library_units
      // satellite keyed on unit_id) is retired with this cutover — that satellite is
      // dropped separately. outcome + outcome_score on library_atoms is the record.

      return updated;
    });
    } catch (txErr) {
      if (txErr instanceof Error && txErr.message === 'CONFLICT') {
        await emitEventEnd(startId, { error: { message: 'Proposal was modified by another user', code: 'CONFLICT' } });
        return NextResponse.json(
          { error: 'Proposal was modified by another user', code: 'CONFLICT' },
          { status: 409 },
        );
      }
      console.error('[api/portal/proposals/outcome] transaction failed:', txErr);
      await emitEventEnd(startId, { error: { message: String(txErr), code: 'DB_ERROR' } });
      return NextResponse.json(
        { error: 'Internal server error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    // ── #13: close the record-outcome nudge ────────────────────────
    // The outcome is now durably recorded — auto-complete the `record_outcome` ToDo
    // that submission raised, so it drops out of the tenant's queue. Best-effort.
    await completeOutcomeTodos(tenantId, proposalId, sessionUser.id, outcome);

    // ── End event ────────────────────────────────────────────────────
    await emitEventEnd(startId, {
      result: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        outcome,
        notes,
        atomsUpdated,
      },
    });

    // ── R6 (V2): a WIN seeds a contract on the SAME opportunity_id and launches
    //    a contract-scope ProjectCollaboration kickoff gate — the spine, one scope
    //    deeper. Idempotent (one contract per winning proposal); non-fatal.
    let contractStarted: { contractId: string; kickoffLaunched: boolean } | null = null;
    if (outcome === 'awarded') {
      try {
        let contractId: string | null = null;
        const ins = await sql<{ id: string }[]>`
          INSERT INTO contracts (tenant_id, opportunity_id, proposal_id, title, origin_card)
          VALUES (${tenantId}::uuid, ${proposal.opportunityId}::uuid, ${proposalId}::uuid,
                  ${`Contract: ${proposal.title}`}, ${sql.json(coerceOriginCard(proposal.originCard as never) as Parameters<typeof sql.json>[0])})
          ON CONFLICT (proposal_id) WHERE proposal_id IS NOT NULL DO NOTHING
          RETURNING id
        `;
        if (ins.length > 0) {
          contractId = ins[0].id;
        } else {
          const [existing] = await sql<{ id: string }[]>`
            SELECT id FROM contracts WHERE proposal_id = ${proposalId}::uuid LIMIT 1
          `;
          contractId = existing?.id ?? null;
        }

        if (contractId) {
          // Audit the contract-entity creation itself (the V1→V2 arc) — customer-facing, so
          // capture namespace with the tenant. The kickoff gate posts its own process events.
          await emitEventSingle({
            namespace: 'capture',
            type: 'contract.started',
            actor: userActor(sessionUser.id, sessionUser.email),
            tenantId,
            payload: { contractId, proposalId, opportunityId: proposal.opportunityId, title: `Contract: ${proposal.title}` },
          });
          let kickoffLaunched = false;
          // #190: tenant-side kickoff gate — fully tenant-tunable (not SLA-pinned).
          const pol = await resolveGatePolicy({
            tenantId,
            scope: 'build',
            triggerKey: 'contract_kickoff',
            gateDefaults: { assigneeRole: 'tenant_admin', nudgeDays: [3, 1], dueInMinutes: 10080 },
          });
          if (pol.enabled) {
            const launch = await launchProjectCollaboration({
              actor: { id: sessionUser.id, email: sessionUser.email ?? null, role, tenantId },
              tenantId,
              scope: 'contract',
              opportunityId: proposal.opportunityId,
              taskType: 'contract_kickoff',
              taskTitle: `Kick off contract: ${proposal.title}`,
              assigneeRole: pol.assigneeRole,
              entityType: 'contract',
              entityRef: contractId,
              nudgeDays: pol.nudgeDays,
              dueMinutes: pol.dueInMinutes,
            });
            if (!launch.ok) {
              console.error('[proposals/outcome] contract kickoff launch refused:', launch.code, launch.error);
            } else {
              kickoffLaunched = true;
            }
          }
          contractStarted = { contractId, kickoffLaunched };
        }
      } catch (contractErr) {
        console.error('[proposals/outcome] contract seed failed (non-fatal):', contractErr);
      }
    }

    // ── Activity log ────────────────────────────────────────────────
    try {
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role,
           activity_type, details)
        VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                ${sessionUser.email ?? null}, ${role},
                'outcome_recorded',
                ${sql.json({ outcome, notes: notes ?? undefined, atoms_updated: atomsUpdated })})
      `;
    } catch (logErr) {
      console.error('[api/portal/proposals/outcome] activity log failed', logErr);
    }

    return NextResponse.json({
      data: {
        proposalId,
        outcome,
        atomsUpdated,
        stage: 'archived',
        contractStarted,
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message === 'CONFLICT') {
      return NextResponse.json(
        { error: 'Proposal was modified by another user', code: 'CONFLICT' },
        { status: 409 },
      );
    }
    console.error('[api/portal/proposals/outcome] POST error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
