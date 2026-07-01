/**
 * GET /api/portal/[tenantSlug]/cards
 *
 * The tenant's opportunity pipeline — its denormalized thin cards (mig 094),
 * read RLS-scoped via withTenant() (SET LOCAL app.tenant_id). Every card is a
 * self-contained snapshot from the bridge; no JOIN to global opportunities.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { withTenant } from '@/lib/rls';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const sessionUser = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(sessionUser.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    const url = new URL(request.url);
    const includeClosed = url.searchParams.get('includeClosed') === 'true';
    const pinnedOnly = url.searchParams.get('pinned') === 'true';

    try {
      const cards = await withTenant(tenantId, async (tx) => {
        // Explicit tenant predicate (belt) + RLS (suspenders, once the app runs as govtech_app).
        return tx`
          SELECT id, opportunity_id, card, bridge_version, lifecycle_status, pursuit_status,
                 is_pinned, pin_update_available, pinned_at, created_at, updated_at
          FROM tenant_opportunity_cards
          WHERE tenant_id = ${tenantId}::uuid
            ${includeClosed ? tx`` : tx`AND lifecycle_status <> 'archived'`}
            ${pinnedOnly ? tx`AND is_pinned = true` : tx``}
          ORDER BY is_pinned DESC, updated_at DESC
          LIMIT 1000
        `;
      });
      return NextResponse.json({ data: { cards } });
    } catch (dbErr) {
      console.error('[portal/cards] query failed', dbErr);
      return NextResponse.json({ error: 'Failed to load cards', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (err) {
    console.error('[portal/cards] error', err);
    return NextResponse.json({ error: 'Failed to load cards', code: 'DB_ERROR' }, { status: 500 });
  }
}
