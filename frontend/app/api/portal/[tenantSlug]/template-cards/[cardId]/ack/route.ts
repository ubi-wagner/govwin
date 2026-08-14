/**
 * POST /api/portal/[tenantSlug]/template-cards/[cardId]/ack
 *
 * Acknowledge a refreshed template card (template bridge Phase 3). When an admin
 * pushes a new version, the forward-only fan-out has ALREADY applied the new
 * skeleton to the tenant's owned card (instances untouched) and flagged
 * update_available. This clears that "refreshed" flag once the tenant has seen it.
 *
 * Auth: tenant_user+ with tenant access.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { withTenant } from '@/lib/rls';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext { params: Promise<{ tenantSlug: string; cardId: string }> }

export async function POST(_request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, cardId } = await ctx.params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!isValidUUID(cardId)) {
      return NextResponse.json({ error: 'Invalid card id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(su.id, role, tenantId))) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    try {
      // Explicit tenant predicate (belt) + RLS (suspenders).
      const rows = await withTenant<Array<{ id: string }>>(tenantId, async (tx) => tx`
        UPDATE tenant_template_cards SET update_available = false, updated_at = now()
        WHERE id = ${cardId}::uuid AND tenant_id = ${tenantId}::uuid
        RETURNING id
      `);
      if (rows.length === 0) {
        return NextResponse.json({ error: 'Template not found', code: 'NOT_FOUND' }, { status: 404 });
      }
    } catch (e) {
      console.error('[portal/template-cards/ack] update failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Terminal step of the template-refresh chain (detect → push → apply → ACKNOWLEDGE):
    // audit it so a future workflow can consume "has this tenant seen the refreshed skeleton?".
    await emitEventSingle({
      namespace: 'library',
      type: 'template.acknowledged',
      actor: userActor(su.id),
      tenantId,                       // real tenant UUID — portal action
      payload: { cardId },
    });

    return NextResponse.json({ data: { acknowledged: true } });
  } catch (e) {
    console.error('[portal/template-cards/ack] POST failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
