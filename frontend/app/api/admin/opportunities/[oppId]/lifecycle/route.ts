import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';
import type { Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ oppId: string }>;
}

const EVENT_TYPE: Record<string, string> = {
  close: 'opportunity.closed',
  archive: 'opportunity.archived',
  reopen: 'opportunity.reopened',
  close_date_change: 'opportunity.close_date_changed',
};
const VALID_ACTIONS = Object.keys(EVENT_TYPE);

/**
 * POST /api/admin/opportunities/[oppId]/lifecycle
 *
 * RFP-admin opportunity lifecycle control (C6). Actions: close, archive, reopen,
 * close_date_change. Soft-state — opportunities are never deleted, so proposals
 * referencing a closed/archived opportunity keep working. is_active is kept in
 * sync with lifecycle_status so the customer spotlight feed (WHERE is_active)
 * hides closed/archived opps and reopening restores them. Every transition is
 * audited (opportunity_lifecycle_actions) and emits a finder event.
 *
 * Body: { action, reason?, closeDate? (ISO, required for close_date_change) }
 * Auth: rfp_admin or master_admin.
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { id?: string; email?: string; role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!user.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { oppId } = await ctx.params;
    if (!isValidUUID(oppId)) {
      return NextResponse.json({ error: 'Invalid opportunity ID', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let body: { action?: unknown; reason?: unknown; closeDate?: unknown } = {};
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const action = typeof body.action === 'string' ? body.action : '';
    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: `action must be one of ${VALID_ACTIONS.join(', ')}`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 2000) : null;
    const newCloseDate = typeof body.closeDate === 'string' ? body.closeDate : null;
    if (action === 'close_date_change' && (!newCloseDate || Number.isNaN(Date.parse(newCloseDate)))) {
      return NextResponse.json({ error: 'A valid closeDate (ISO) is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ── Load current opportunity ─────────────────────────────────────
    let opp: { id: string; title: string; lifecycleStatus: string; closeDate: Date | null } | undefined;
    try {
      [opp] = await sql<{ id: string; title: string; lifecycleStatus: string; closeDate: Date | null }[]>`
        SELECT id, title, lifecycle_status, close_date FROM opportunities WHERE id = ${oppId}::uuid LIMIT 1
      `;
    } catch (e) {
      console.error('[admin/opportunities/lifecycle] load failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!opp) {
      return NextResponse.json({ error: 'Opportunity not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const fromStatus = opp.lifecycleStatus;
    let toStatus = fromStatus;
    let updatedCount = 0;

    try {
      await sql.begin(async (tx: any) => {
        let result: { count: number };
        if (action === 'close') {
          toStatus = 'closed';
          result = await tx`
            UPDATE opportunities
            SET lifecycle_status = 'closed', is_active = false, closed_at = now(), closed_reason = ${reason}
            WHERE id = ${oppId}::uuid AND lifecycle_status = 'open'
          `;
        } else if (action === 'archive') {
          toStatus = 'archived';
          result = await tx`
            UPDATE opportunities
            SET lifecycle_status = 'archived', is_active = false,
                closed_at = COALESCE(closed_at, now()), closed_reason = COALESCE(${reason}, closed_reason)
            WHERE id = ${oppId}::uuid AND lifecycle_status IN ('open', 'closed')
          `;
        } else if (action === 'reopen') {
          toStatus = 'open';
          result = await tx`
            UPDATE opportunities
            SET lifecycle_status = 'open', is_active = true, reopened_at = now(),
                closed_at = NULL, closed_reason = NULL
            WHERE id = ${oppId}::uuid AND lifecycle_status IN ('closed', 'archived')
          `;
        } else {
          // close_date_change — status unchanged
          result = await tx`
            UPDATE opportunities
            SET previous_close_date = close_date, close_date = ${newCloseDate}::timestamptz, close_date_changed_at = now()
            WHERE id = ${oppId}::uuid
          `;
        }
        updatedCount = result.count;
        if (updatedCount === 0) {
          // No row matched the allowed-from guard → invalid transition.
          throw new Error('INVALID_TRANSITION');
        }
        await tx`
          INSERT INTO opportunity_lifecycle_actions
            (opportunity_id, actor_id, action, from_status, to_status, reason, metadata)
          VALUES (${oppId}::uuid, ${user.id}::uuid, ${action}, ${fromStatus}, ${toStatus}, ${reason},
                  ${JSON.stringify(newCloseDate ? { newCloseDate } : {})}::jsonb)
        `;
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'INVALID_TRANSITION') {
        return NextResponse.json(
          { error: `Cannot ${action} an opportunity in '${fromStatus}' state`, code: 'INVALID_TRANSITION' },
          { status: 409 },
        );
      }
      console.error('[admin/opportunities/lifecycle] transition failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ── Audit event (best-effort) ────────────────────────────────────
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: EVENT_TYPE[action],
        actor: userActor(user.id, user.email),
        payload: {
          opportunityId: oppId,
          title: opp.title,
          fromStatus,
          toStatus,
          reason: reason ?? undefined,
          ...(action === 'close_date_change'
            ? { previousCloseDate: opp.closeDate?.toISOString?.() ?? null, newCloseDate }
            : {}),
        },
      });
    } catch (e) {
      console.error('[admin/opportunities/lifecycle] event emit failed:', e);
    }

    return NextResponse.json({
      data: { opportunityId: oppId, action, fromStatus, toStatus, ...(newCloseDate ? { closeDate: newCloseDate } : {}) },
    });
  } catch (e) {
    console.error('[admin/opportunities/lifecycle] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
