/**
 * POST /api/portal/[tenantSlug]/cards/[opportunityId]/pursuit  { status }
 *
 * THE VERDICT. The customer's opinion of an opportunity, and nothing else (mig 240).
 *
 *     unreviewed   no verdict yet (default)
 *     monitoring   THUMBS UP  — interested. Sorts up, earns nudges, feeds positive affinity,
 *                               and reveals "View Solicitation" (the separate transfer action).
 *     pursuing     actively pursuing. Set by PURCHASE, not by the thumb — buying is a strictly
 *                               stronger statement than liking, and the nudge sweep already
 *                               (correctly) leaves `pursuing` alone.
 *     passed       THUMBS DOWN — sorts last, filtered from the default view, feeds negative
 *                               affinity. Negative signal is worth nearly as much as positive.
 *
 * ── THIS HANDLER MUST NOT BE ABLE TO FAIL FOR AN EXTERNAL REASON ─────────────────────────────
 * A verdict is a pure state change: one UPDATE, no object storage, no network. That is the whole
 * point of splitting it from the document copy — an opinion must never be lost because S3
 * hiccuped. Anything that can fail for a reason outside this database belongs in the transfer
 * (POST …/documents), where failing loudly is the correct behaviour.
 *
 * ── AND IT NEVER REMOVES ANYTHING ────────────────────────────────────────────────────────────
 * The mirror is a 100% mirror: every non-archived admin card exists for every tenant. A verdict
 * sorts and filters; it does not delete a row, and it does not delete a document copy already
 * made. A customer who passes on something and is later told by an advisor to pursue it must find
 * it, and find it current — so a passed card keeps receiving every RFP-admin republish.
 *
 * RLS-scoped; advisory, never touches the global bridge. Emits capture:opportunity.pursuit_set
 * (with the PRIOR verdict, which is what makes the event a usable signal rather than a snapshot).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { withTenant } from '@/lib/rls';
import { emitEventSingle, userActor } from '@/lib/events';

const PURSUIT = ['unreviewed', 'pursuing', 'monitoring', 'passed'] as const;

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string; opportunityId: string }> }) {
  try {
    const { tenantSlug, opportunityId } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'tenant_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    if (!isValidUUID(opportunityId)) return NextResponse.json({ error: 'Invalid opportunity id', code: 'VALIDATION_ERROR' }, { status: 400 });

    let body: { status?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const status = body.status;
    if (typeof status !== 'string' || !(PURSUIT as readonly string[]).includes(status)) {
      return NextResponse.json({ error: `status must be one of ${PURSUIT.join(', ')}`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

    // `pursuit_set_at` is stamped only when a verdict is actually CAST. Clearing back to
    // 'unreviewed' nulls it rather than recording "they had no opinion at 14:32" — the affinity
    // signal weighs recent votes more heavily, and an un-vote is the absence of one, not a fresh
    // one. RETURNING the prior value so the event can carry what changed.
    const [row] = await withTenant(tenantId, async (tx) =>
      tx<Array<{ priorStatus: string | null }>>`
        UPDATE tenant_opportunity_cards c
           SET pursuit_status = ${status},
               -- DB clock, not the app's, so it cannot disagree with updated_at on the same row.
               pursuit_set_at = CASE WHEN ${status} = 'unreviewed' THEN NULL ELSE now() END,
               updated_at = now()
          FROM (SELECT id, pursuit_status FROM tenant_opportunity_cards
                 WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid) prev
         WHERE c.id = prev.id
        RETURNING prev.pursuit_status AS prior_status`,
    );
    if (!row) return NextResponse.json({ error: 'Card not found for this tenant', code: 'NOT_FOUND' }, { status: 404 });

    try {
      await emitEventSingle({
        namespace: 'capture',
        type: 'opportunity.pursuit_set',
        actor: userActor(u.id, u.email ?? undefined),
        tenantId,
        // The PRIOR verdict rides along: "unreviewed → passed" and "monitoring → passed" are very
        // different facts about a customer, and an event carrying only the new value throws the
        // second one away. The admin demand queue reads exactly this difference.
        payload: { opportunityId, status, priorStatus: row.priorStatus ?? 'unreviewed' },
      });
    } catch (e) { console.error('[cards/pursuit] event emit failed (non-fatal)', e); }

    return NextResponse.json({ data: { status } });
  } catch (err) {
    console.error('[cards/pursuit] error', err);
    return NextResponse.json({ error: 'Could not update pursuit status', code: 'DB_ERROR' }, { status: 500 });
  }
}
