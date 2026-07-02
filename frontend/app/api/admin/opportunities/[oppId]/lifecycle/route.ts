import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';
import type { Role } from '@/lib/rbac';
import {
  canTransition, coarseStatus, isActiveStage, eventTypeForStage,
  isSubmissionStage, allowedTransitions, type SubmissionStage,
} from '@/lib/lifecycle';
import { republishIfReleased } from '@/lib/opportunity-bridge';

interface RouteContext {
  params: Promise<{ oppId: string }>;
}

// Legacy actions map to a target stage; `set_stage` carries `toStage` directly.
const ACTION_TO_STAGE: Record<string, SubmissionStage> = { close: 'closed', archive: 'archived', reopen: 'open' };
const VALID_ACTIONS = ['close', 'archive', 'reopen', 'set_stage', 'close_date_change'];

/** Finder event derived from the transition so listeners fire regardless of how it was invoked. */
function finderEventForTransition(from: SubmissionStage, to: SubmissionStage): string {
  if (to === 'closed') return 'opportunity.closed';
  if (to === 'archived') return 'opportunity.archived';
  if (to === 'open' && coarseStatus(from) !== 'open') return 'opportunity.reopened';
  return 'opportunity.stage_changed';
}

/**
 * POST /api/admin/opportunities/[oppId]/lifecycle
 *
 * RFP-admin opportunity lifecycle control over the canonical 6-state submission
 * stage (nofo / pre_release / open / updated / closed / archived, mig 100). The
 * coarse `lifecycle_status` + `is_active` are kept in sync so existing feed/ranking
 * filters keep working. Every stage-changing transition is validated
 * (lib/lifecycle canTransition), audited (opportunity_lifecycle_actions), emits a
 * finder event, AND — if the opp is already released — re-publishes to the bridge
 * so it fans out to every tenant card.
 *
 * Body: { action: 'set_stage'|'close'|'archive'|'reopen'|'close_date_change',
 *         toStage? (for set_stage), reason?, closeDate? (for close_date_change) }
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

    let body: { action?: unknown; toStage?: unknown; reason?: unknown; closeDate?: unknown } = {};
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
    let opp: { id: string; title: string; submissionStage: string; closeDate: Date | null } | undefined;
    try {
      [opp] = await sql<{ id: string; title: string; submissionStage: string; closeDate: Date | null }[]>`
        SELECT id, title, submission_stage, close_date FROM opportunities WHERE id = ${oppId}::uuid LIMIT 1
      `;
    } catch (e) {
      console.error('[admin/opportunities/lifecycle] load failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!opp) {
      return NextResponse.json({ error: 'Opportunity not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const fromStage: SubmissionStage = isSubmissionStage(opp.submissionStage) ? opp.submissionStage : 'open';

    // ── close_date_change: no stage change, but a customer-visible update ──
    if (action === 'close_date_change') {
      try {
        await sql.begin(async (tx: any) => {
          await tx`
            UPDATE opportunities
            SET previous_close_date = close_date, close_date = ${newCloseDate}::timestamptz,
                close_date_changed_at = now(), updated_at = now()
            WHERE id = ${oppId}::uuid
          `;
          await tx`
            INSERT INTO opportunity_lifecycle_actions
              (opportunity_id, actor_id, action, from_status, to_status, reason, metadata)
            VALUES (${oppId}::uuid, ${user.id}::uuid, 'close_date_change', ${fromStage}, ${fromStage}, ${reason},
                    ${JSON.stringify({ newCloseDate })}::jsonb)
          `;
        });
      } catch (e) {
        console.error('[admin/opportunities/lifecycle] close_date_change failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
      await emitFinder('opportunity.close_date_changed', oppId, opp.title, fromStage, fromStage, reason, {
        previousCloseDate: opp.closeDate?.toISOString?.() ?? null, newCloseDate,
      }, user);
      await fanOut(oppId, 'updated', user.id);
      return NextResponse.json({ data: { opportunityId: oppId, action, fromStage, toStage: fromStage, closeDate: newCloseDate } });
    }

    // ── stage-changing actions (set_stage / close / archive / reopen) ──
    const rawTo = action === 'set_stage' ? body.toStage : ACTION_TO_STAGE[action];
    if (!isSubmissionStage(rawTo)) {
      return NextResponse.json({ error: 'toStage must be a valid submission stage', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const toStage: SubmissionStage = rawTo;
    if (!canTransition(fromStage, toStage)) {
      return NextResponse.json(
        { error: `Cannot move from '${fromStage}' to '${toStage}'. Allowed: ${allowedTransitions(fromStage).join(', ') || 'none'}`, code: 'INVALID_TRANSITION' },
        { status: 409 },
      );
    }

    const toCoarse = coarseStatus(toStage);
    const fromCoarse = coarseStatus(fromStage);
    let updatedCount = 0;
    try {
      updatedCount = await sql.begin(async (tx: any) => {
        let res: { count: number };
        // CAS on submission_stage guards against a concurrent transition.
        if (toCoarse === 'open' && fromCoarse !== 'open') {
          // reopen / un-archive
          res = await tx`
            UPDATE opportunities
            SET submission_stage = ${toStage}, lifecycle_status = 'open', is_active = true,
                reopened_at = now(), closed_at = NULL, closed_reason = NULL, updated_at = now()
            WHERE id = ${oppId}::uuid AND submission_stage = ${fromStage}
          `;
        } else if (toCoarse === 'open') {
          // forward within the open band (nofo → pre_release → open → updated)
          res = await tx`
            UPDATE opportunities
            SET submission_stage = ${toStage}, lifecycle_status = 'open', is_active = true, updated_at = now()
            WHERE id = ${oppId}::uuid AND submission_stage = ${fromStage}
          `;
        } else {
          // closed / archived
          res = await tx`
            UPDATE opportunities
            SET submission_stage = ${toStage}, lifecycle_status = ${toCoarse}, is_active = false,
                closed_at = COALESCE(closed_at, now()), closed_reason = COALESCE(${reason}, closed_reason), updated_at = now()
            WHERE id = ${oppId}::uuid AND submission_stage = ${fromStage}
          `;
        }
        if (res.count === 0) throw new Error('CAS_LOST');
        await tx`
          INSERT INTO opportunity_lifecycle_actions
            (opportunity_id, actor_id, action, from_status, to_status, reason, metadata)
          VALUES (${oppId}::uuid, ${user.id}::uuid, ${action}, ${fromStage}, ${toStage}, ${reason},
                  ${JSON.stringify({ toStage })}::jsonb)
        `;
        return res.count;
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'CAS_LOST') {
        return NextResponse.json(
          { error: `Opportunity stage changed concurrently; expected '${fromStage}'`, code: 'INVALID_TRANSITION' },
          { status: 409 },
        );
      }
      console.error('[admin/opportunities/lifecycle] transition failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    await emitFinder(finderEventForTransition(fromStage, toStage), oppId, opp.title, fromStage, toStage, reason, {}, user);
    // Propagate to every tenant card (no-op if the opp was never released).
    await fanOut(oppId, eventTypeForStage(fromStage, toStage), user.id);

    return NextResponse.json({ data: { opportunityId: oppId, action, fromStage, toStage, updated: updatedCount } });
  } catch (e) {
    console.error('[admin/opportunities/lifecycle] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

// ── helpers (best-effort side effects; never fail the transition) ──
async function emitFinder(
  type: string, oppId: string, title: string, fromStage: string, toStage: string,
  reason: string | null, extra: Record<string, unknown>, user: { id?: string; email?: string },
): Promise<void> {
  try {
    await emitEventSingle({
      namespace: 'finder', type,
      actor: userActor(user.id!, user.email),
      payload: { opportunityId: oppId, title, fromStage, toStage, reason: reason ?? undefined, ...extra },
    });
  } catch (e) {
    console.error('[admin/opportunities/lifecycle] event emit failed:', e);
  }
}

async function fanOut(oppId: string, eventType: Parameters<typeof republishIfReleased>[1], actorId: string | undefined): Promise<void> {
  try {
    await republishIfReleased(oppId, eventType, actorId ?? null, new Date().toISOString());
  } catch (e) {
    console.error('[admin/opportunities/lifecycle] bridge fan-out failed (non-fatal):', e);
  }
}
