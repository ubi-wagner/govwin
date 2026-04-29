/**
 * POST /api/admin/rfp-curation/[solId]/triage
 *
 * Records a triage action (claim, dismiss, release, etc.) against a
 * curated solicitation. Inserts an audit row into `triage_actions`,
 * updates `curated_solicitations.status` according to the action's
 * state-machine mapping, and emits a `finder.solicitation.triaged`
 * event.
 *
 * Body: { action: string, notes?: string }
 *
 * Returns: { data: { triageActionId, solicitationId, action, fromState, toState } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';
import type { Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Maps triage action names to the solicitation status they produce.
 * `from` lists the statuses from which this action is legal.
 */
const ACTION_STATE_MAP: Record<string, { to: string; from: string[] }> = {
  claim:              { to: 'claimed',              from: ['new'] },
  release:            { to: 'released_for_analysis', from: ['claimed'] },
  dismiss:            { to: 'dismissed',            from: ['new', 'claimed', 'released_for_analysis', 'ai_analyzed', 'curation_in_progress', 'rejected_review'] },
  request_review:     { to: 'review_requested',     from: ['curation_in_progress'] },
  approve:            { to: 'approved',              from: ['review_requested'] },
  reject:             { to: 'rejected_review',       from: ['review_requested'] },
  push:               { to: 'pushed_to_pipeline',    from: ['approved'] },
  reclaim:            { to: 'claimed',               from: ['released_for_analysis', 'ai_analyzed', 'rejected_review'] },
  skip_shredder:      { to: 'curation_in_progress',  from: ['claimed', 'released_for_analysis', 'ai_analyzed'] },
  return_to_curation: { to: 'curation_in_progress',  from: ['review_requested', 'approved', 'rejected_review'] },
};

const VALID_ACTIONS = Object.keys(ACTION_STATE_MAP);

export async function POST(
  request: Request,
  routeCtx: RouteContext,
) {
  try {
    // ── Auth check ──────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const user = session.user as {
      id?: string;
      email?: string;
      role?: Role;
    };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { solId } = await routeCtx.params;

    // ── Validate UUID format ────────────────────────────────────────
    if (!UUID_RE.test(solId)) {
      return NextResponse.json(
        { error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Parse body ──────────────────────────────────────────────────
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Request body must be valid JSON', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const action = body.action;
    const notes = body.notes;

    if (typeof action !== 'string' || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    if (notes !== undefined && typeof notes !== 'string') {
      return NextResponse.json(
        { error: 'notes must be a string', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const mapping = ACTION_STATE_MAP[action];
    const actorId = user.id!;

    // ── Fetch current state ─────────────────────────────────────────
    const existing = await sql<{ status: string }[]>`
      SELECT status FROM curated_solicitations
      WHERE id = ${solId}::uuid
    `;

    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const fromState = existing[0].status;

    if (!mapping.from.includes(fromState)) {
      return NextResponse.json(
        { error: `Cannot perform '${action}' from status '${fromState}'`, code: 'STATE_TRANSITION_ERROR' },
        { status: 409 },
      );
    }

    // ── Update solicitation status ──────────────────────────────────
    const toState = mapping.to;

    const updateFields: Record<string, string | null> = {};
    if (action === 'claim' || action === 'reclaim') {
      updateFields.claimedBy = actorId;
    }
    if (action === 'dismiss') {
      updateFields.dismissedReason = typeof notes === 'string' ? notes : null;
    }

    // Use a conditional UPDATE that also acts as a race guard
    const updated = await sql<{ id: string }[]>`
      UPDATE curated_solicitations
      SET status = ${toState},
          claimed_by = CASE WHEN ${action} IN ('claim', 'reclaim') THEN ${actorId}::uuid ELSE claimed_by END,
          claimed_at = CASE WHEN ${action} IN ('claim', 'reclaim') THEN now() ELSE claimed_at END,
          dismissed_reason = CASE WHEN ${action} = 'dismiss' THEN ${typeof notes === 'string' ? notes : null} ELSE dismissed_reason END,
          curated_by = CASE WHEN ${action} = 'request_review' THEN ${actorId}::uuid ELSE curated_by END,
          approved_by = CASE WHEN ${action} = 'approve' THEN ${actorId}::uuid ELSE approved_by END,
          pushed_at = CASE WHEN ${action} = 'push' THEN now() ELSE pushed_at END,
          updated_at = now()
      WHERE id = ${solId}::uuid
        AND status = ${fromState}
      RETURNING id
    `;

    if (updated.length === 0) {
      return NextResponse.json(
        { error: 'Status changed concurrently, please retry', code: 'CONFLICT' },
        { status: 409 },
      );
    }

    // ── Insert triage audit row ─────────────────────────────────────
    const [triageRow] = await sql<{ id: string }[]>`
      INSERT INTO triage_actions
        (solicitation_id, actor_id, action, from_state, to_state, notes)
      VALUES
        (${solId}::uuid, ${actorId}::uuid, ${action}, ${fromState}, ${toState}, ${typeof notes === 'string' ? notes : null})
      RETURNING id
    `;

    // ── Emit event ──────────────────────────────────────────────────
    await emitEventSingle({
      namespace: 'finder',
      type: 'solicitation.triaged',
      actor: userActor(actorId, user.email),
      payload: {
        correlationId: randomUUID(),
        solicitationId: solId,
        action,
        fromState,
        toState,
      },
    });

    return NextResponse.json({
      data: {
        triageActionId: triageRow.id,
        solicitationId: solId,
        action,
        fromState,
        toState,
      },
    });
  } catch (error) {
    console.error('[rfp-curation] POST triage failed:', error);
    return NextResponse.json(
      { error: 'Failed to record triage action', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
