/**
 * Archive lifecycle — POST /api/portal/[tenantSlug]/cards/[opportunityId]/archive
 *   { action: 'archive' } → soft-archive the tenant's opportunity card: hide it from the
 *                           active /cards views. The row stays in indexed Postgres (restorable).
 *   { action: 'restore' } → un-archive it back into the active pipeline.
 *
 * Soft-archive is a tenant-scoped visibility/sorting state (tenant_opportunity_cards.archived_at,
 * mig 148) per the Archivable contract (docs/ARCHIVABLE_CONTRACT.md) — reversible, never a delete.
 * Both actions are compare-and-swap (409 when there is nothing to do) and idempotent. The card is
 * keyed per tenant by (tenant_id, opportunity_id) — the same WHERE shape as the sibling pin route.
 *
 * Auth: tenant_admin or above with tenant access (mirrors the pin route + the /cards page gate).
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { withTenant } from '@/lib/rls';
import { emitEventSingle, userActor } from '@/lib/events';

async function resolve(tenantSlug: string, opportunityId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const sessionUser = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, 'tenant_admin')) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  if (!isValidUUID(opportunityId)) return { error: NextResponse.json({ error: 'Invalid opportunity id', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(sessionUser.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: sessionUser.id, email: sessionUser.email ?? null };
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string; opportunityId: string }> }) {
  try {
    const { tenantSlug, opportunityId } = await params;
    const r = await resolve(tenantSlug, opportunityId);
    if ('error' in r) return r.error;

    let body: { action?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    if (body.action !== 'archive' && body.action !== 'restore') {
      return NextResponse.json({ error: "action must be 'archive' or 'restore'", code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const action = body.action; // 'archive' | 'restore' (validated above)

    try {
      // Compare-and-swap on archived_at so the action is idempotent and a no-op 409s:
      // archive only an ACTIVE card (archived_at IS NULL); restore only an ARCHIVED one
      // (archived_at IS NOT NULL). Tenant-scoped by (tenant_id, opportunity_id) under RLS
      // (withTenant), the same per-tenant card key as the pin route.
      const rows = await withTenant<Array<{ id: string }>>(r.tenantId, async (tx) => {
        if (action === 'archive') {
          return tx<Array<{ id: string }>>`
            UPDATE tenant_opportunity_cards
            SET archived_at = now(), updated_at = now()
            WHERE tenant_id = ${r.tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid AND archived_at IS NULL
            RETURNING id
          `;
        }
        return tx<Array<{ id: string }>>`
          UPDATE tenant_opportunity_cards
          SET archived_at = NULL, updated_at = now()
          WHERE tenant_id = ${r.tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid AND archived_at IS NOT NULL
          RETURNING id
        `;
      });
      if (rows.length === 0) {
        return NextResponse.json(
          {
            error: action === 'archive' ? 'Card is already archived (or not found for this tenant)' : 'Card is not archived (nothing to restore)',
            code: 'CONFLICT',
          },
          { status: 409 },
        );
      }
      // Audit: a customer archiving/restoring a card is a first-class capture event, tenant-scoped
      // (ARCHIVABLE_CONTRACT.md rule 4 · the card artifact is owned by the `capture` namespace).
      await emitEventSingle({
        namespace: 'capture',
        type: action === 'archive' ? 'card.archived' : 'card.restored',
        actor: userActor(r.userId, r.email ?? undefined),
        tenantId: r.tenantId,
        payload: { opportunityId },
      });
      return NextResponse.json({ data: { archived: action === 'archive' } });
    } catch (e) {
      console.error('[portal/cards/archive] action failed', e);
      return NextResponse.json({ error: 'Archive action failed', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (err) {
    console.error('[portal/cards/archive] error', err);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
