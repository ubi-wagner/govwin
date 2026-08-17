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
import { sql, enterBypass } from '@/lib/db';
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

type SetResult = 'not_found' | 'noop' | { id: string; name: string };

async function setArchived(tenantId: string, archived: boolean): Promise<SetResult> {
  // This is a legitimate cross-tenant admin op that writes the RLS-forced process_instances (and
  // reads proposals) for ANY tenant. Without a context the cascade UPDATEs run as govtech_app with an
  // unset app.tenant_id → RLS collapses them to zero rows (a silent no-op that leaves an archived
  // company's workflows live). Route through the owner pool, same as the sibling amendments route.
  enterBypass();
  // Existence + state check first, so a no-op 409s (not a silent 200 that resets the retention
  // watermark) and an unknown id 404s — compare-and-swap parity with the proposal/atom archive routes.
  const [existing] = await sql<{ id: string; name: string; archivedAt: Date | string | null }[]>`
    SELECT id, name, archived_at AS "archivedAt" FROM tenants WHERE id = ${tenantId} LIMIT 1`;
  if (!existing) return 'not_found';
  const alreadyInState = archived ? existing.archivedAt != null : existing.archivedAt == null;
  if (alreadyInState) return 'noop';

  const [row] = await sql<{ id: string; name: string }[]>`
    UPDATE tenants SET archived_at = ${archived ? sql`now()` : null}, updated_at = now()
    WHERE id = ${tenantId} RETURNING id, name`;
  if (!row) return 'not_found';

  // Cascade the tenant's instantiated workflows with the license state. On RESTORE, do NOT reactivate
  // workflows whose owning portal is still archived (portal archive writes archived_at on the same
  // rows via a separate scope; archived_at carries no provenance, so gate the restore on portal stage).
  try {
    if (archived) {
      await sql`UPDATE process_instances SET archived_at = now() WHERE tenant_id = ${tenantId}::uuid AND archived_at IS NULL`;
    } else {
      await sql`
        UPDATE process_instances pi SET archived_at = NULL
        WHERE pi.tenant_id = ${tenantId}::uuid AND pi.archived_at IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM proposals p
            WHERE p.tenant_id = pi.tenant_id AND p.opportunity_id = pi.opportunity_id AND p.stage = 'archived'
          )`;
    }
  } catch (e) {
    console.error('[admin/tenants/archive] workflow cascade failed', e);
  }
  return row;
}

export async function POST(_request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const gate = await requireAdmin();
    if (gate.error) return gate.error;
    const { tenantId } = await params;
    if (!isValidUUID(tenantId)) {
      return NextResponse.json({ error: 'Invalid tenant id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const r = await setArchived(tenantId, true);
    if (r === 'not_found') return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    if (r === 'noop') return NextResponse.json({ error: 'Tenant is already archived', code: 'CONFLICT' }, { status: 409 });
    // finder = admin namespace → tenantId=null per the Events SOP; the tenant identity lives in payload.
    await emitEventSingle({
      namespace: 'finder',
      type: 'tenant.archived',
      actor: userActor(gate.user.id ?? '', gate.user.email ?? undefined),
      payload: { tenantId, tenantName: r.name, reason: 'license_lapsed' },
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
    const r = await setArchived(tenantId, false);
    if (r === 'not_found') return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    if (r === 'noop') return NextResponse.json({ error: 'Tenant is not archived', code: 'CONFLICT' }, { status: 409 });
    await emitEventSingle({
      namespace: 'finder',
      type: 'tenant.restored',
      actor: userActor(gate.user.id ?? '', gate.user.email ?? undefined),
      payload: { tenantId, tenantName: r.name, reason: 'license_renewed' },
    });
    return NextResponse.json({ data: { archived: false } });
  } catch (err) {
    console.error('[admin/tenants/archive] DELETE error', err);
    return NextResponse.json({ error: 'Failed to restore', code: 'DB_ERROR' }, { status: 500 });
  }
}
