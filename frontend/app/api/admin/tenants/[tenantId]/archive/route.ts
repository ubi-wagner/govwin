/**
 * Company-level ARCHIVE (license slumber) — RFP-admin only.
 *
 *   POST   /api/admin/tenants/[tenantId]/archive   → archive (license lapsed)
 *   DELETE /api/admin/tenants/[tenantId]/archive   → restore (renewed)
 *
 * Archiving sets tenants.archived_at; every non-admin user of the company loses access
 * at once (verifyTenantAccess gates on archived_at) WITHOUT touching any user's own
 * membership state — so restoring returns everyone to EXACTLY their prior per-user state
 * (active users active, individually inactive users still inactive). Reversible + audited.
 * See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isValidUUID } from '@/lib/validation';
import type { Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const user = session.user as { id?: string; email?: string; role?: Role };
  if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
    return { error: NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { user };
}

async function setArchived(tenantId: string, archived: boolean): Promise<{ id: string; name: string } | null> {
  const [row] = await sql<{ id: string; name: string }[]>`
    UPDATE tenants
    SET archived_at = ${archived ? sql`now()` : null}, updated_at = now()
    WHERE id = ${tenantId}
    RETURNING id, name`;
  return row ?? null;
}

export async function POST(_request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const gate = await requireAdmin();
    if (gate.error) return gate.error;
    const { tenantId } = await params;
    if (!isValidUUID(tenantId)) {
      return NextResponse.json({ error: 'Invalid tenant id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const tenant = await setArchived(tenantId, true);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    await emitEventSingle({
      namespace: 'finder',
      type: 'tenant.archived',
      actor: userActor(gate.user.id ?? '', gate.user.email ?? undefined),
      tenantId,
      payload: { tenantId, tenantName: tenant.name, reason: 'license_lapsed' },
    });
    return NextResponse.json({ data: { archived: true } });
  } catch (err) {
    console.error('[admin/tenants/archive] POST error', err);
    return NextResponse.json({ error: 'Failed to archive', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const gate = await requireAdmin();
    if (gate.error) return gate.error;
    const { tenantId } = await params;
    if (!isValidUUID(tenantId)) {
      return NextResponse.json({ error: 'Invalid tenant id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const tenant = await setArchived(tenantId, false);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    await emitEventSingle({
      namespace: 'finder',
      type: 'tenant.restored',
      actor: userActor(gate.user.id ?? '', gate.user.email ?? undefined),
      tenantId,
      payload: { tenantId, tenantName: tenant.name, reason: 'license_renewed' },
    });
    return NextResponse.json({ data: { archived: false } });
  } catch (err) {
    console.error('[admin/tenants/archive] DELETE error', err);
    return NextResponse.json({ error: 'Failed to restore', code: 'DB_ERROR' }, { status: 500 });
  }
}
