/**
 * POST /api/admin/rfp-curation/[solId]/broadcast
 *
 * Explicit "push an update to tenants" for a released solicitation: re-publish every
 * activated opp (umbrella + topics) as a new bridge version and re-fan the mirror cards.
 * The content-edit routes already do this automatically; this button is the admin's
 * manual lever — for edits that predate the auto-propagation, after a bulk session of
 * changes, or simply to force pinned holders' "update available" nudge NOW.
 *
 * No-op (200, republished:0) on a never-pushed solicitation — nothing to broadcast to.
 * Auth: rfp_admin / master_admin.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';
import { republishSolicitationCards } from '@/lib/curation/republish';

interface RouteContext { params: Promise<{ solId: string }> }

export async function POST(_req: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    const su = (session as { user?: { id?: string; email?: string; role?: unknown } } | null)?.user;
    const role = isRole(su?.role) ? su!.role : null;
    if (!su?.id || !role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const { solId } = await ctx.params;
    if (!isValidUUID(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const propagation = await republishSolicitationCards({ solicitationId: solId, actorId: su.id });

    try {
      await emitEventSingle({
        namespace: 'finder', type: 'solicitation.broadcast',
        actor: userActor(su.id, su.email ?? undefined), tenantId: null,
        payload: { solicitationId: solId, ...propagation },
      });
    } catch (e) { console.error('[broadcast] event emit failed (non-fatal)', e); }

    return NextResponse.json({ data: { ...propagation } });
  } catch (e) {
    console.error('[broadcast] error', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
