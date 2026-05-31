/**
 * POST /api/admin/rfp-curation/[solId]/force-release
 *
 * Master admin only. Resets a claimed solicitation back to 'new',
 * clears claimed_by / claimed_at, and logs the action to triage_actions.
 * Used when a claim has gone stale (no progress in 24+ hours).
 *
 * Returns: { data: { solicitationId, status } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

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
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    if (role !== 'master_admin') {
      return NextResponse.json({ error: 'master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { solId } = await ctx.params;
    if (!isValidUUID(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation ID', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Load current state
    let sol: { id: string; status: string; claimedBy: string | null; claimedAt: Date | null } | undefined;
    try {
      [sol] = await sql<{ id: string; status: string; claimedBy: string | null; claimedAt: Date | null }[]>`
        SELECT id, status, claimed_by, claimed_at
        FROM curated_solicitations
        WHERE id = ${solId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[rfp-curation/force-release] query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!sol) {
      return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (sol.status !== 'claimed') {
      return NextResponse.json(
        { error: `Cannot force-release a solicitation with status '${sol.status}'`, code: 'INVALID_STATE' },
        { status: 409 },
      );
    }

    // Check staleness (must be claimed > 24h ago for safety)
    if (sol.claimedAt) {
      const hoursAgo = (Date.now() - new Date(sol.claimedAt).getTime()) / 3_600_000;
      if (hoursAgo < 24) {
        return NextResponse.json(
          { error: 'Claim must be at least 24 hours old to force-release', code: 'NOT_STALE' },
          { status: 409 },
        );
      }
    }

    const previousClaimedBy = sol.claimedBy;

    // Reset to 'new'
    try {
      await sql`
        UPDATE curated_solicitations
        SET status = 'new',
            claimed_by = NULL,
            claimed_at = NULL
        WHERE id = ${solId}
          AND status = 'claimed'
      `;
    } catch (e) {
      console.error('[rfp-curation/force-release] update failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Log to triage_actions
    try {
      await sql`
        INSERT INTO triage_actions
          (solicitation_id, actor_id, action, from_state, to_state, notes)
        VALUES (
          ${solId}::uuid,
          ${sessionUser.id}::uuid,
          'reclaim',
          'claimed',
          'new',
          ${`Force-released stale claim from user ${previousClaimedBy ?? 'unknown'} by master_admin`}
        )
      `;
    } catch (logErr) {
      console.error('[rfp-curation/force-release] triage_actions log failed (non-fatal)', logErr);
    }

    // Emit event
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'solicitation.force_released',
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId: null,
        payload: { solicitationId: solId, previousClaimedBy, releasedBy: sessionUser.id },
      });
    } catch {
      // Best-effort
    }

    return NextResponse.json({ data: { solicitationId: solId, status: 'new' } });
  } catch (e) {
    console.error('[rfp-curation/force-release] POST error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
