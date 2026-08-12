/**
 * POST /api/portal/[tenantSlug]/cards/[opportunityId]/pursuit  { status }
 *
 * Sets the tenant's pursuit intent on an opportunity card (mig 094 pursuit_status:
 * unreviewed | pursuing | monitoring | passed). "passed" is the dismiss / "not interested"
 * signal — it drops the card out of the default feed (a negative signal the feed learns from),
 * and can be un-dismissed by setting it back to 'unreviewed'. RLS-scoped; advisory, never
 * touches the global bridge. Emits capture:opportunity.pursuit_set for the admin activity feed.
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

    const updated = await withTenant(tenantId, async (tx) => {
      const rows = await tx<Array<{ id: string }>>`
        UPDATE tenant_opportunity_cards SET pursuit_status = ${status}, updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid
        RETURNING id`;
      return rows.length > 0;
    });
    if (!updated) return NextResponse.json({ error: 'Card not found for this tenant', code: 'NOT_FOUND' }, { status: 404 });

    try {
      await emitEventSingle({
        namespace: 'capture',
        type: 'opportunity.pursuit_set',
        actor: userActor(u.id, u.email ?? undefined),
        tenantId,
        payload: { opportunityId, status },
      });
    } catch (e) { console.error('[cards/pursuit] event emit failed (non-fatal)', e); }

    return NextResponse.json({ data: { status } });
  } catch (err) {
    console.error('[cards/pursuit] error', err);
    return NextResponse.json({ error: 'Could not update pursuit status', code: 'DB_ERROR' }, { status: 500 });
  }
}
