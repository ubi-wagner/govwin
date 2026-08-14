/**
 * GET /api/portal/[tenantSlug]/template-cards/[cardId]
 *
 * One owned template card WITH its pristine CanvasDocument body (mig 177), for
 * the preview drawer. RLS-scoped via withTenant(); the card is a self-contained
 * snapshot — no JOIN to the master template.
 *
 * Auth: tenant_user+ with tenant access (RFP/master admin via shadow).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { withTenant } from '@/lib/rls';
import { isValidUUID } from '@/lib/validation';
import { coerceJsonb } from '@/lib/jsonb';
import type { TemplateSnapshot } from '@/lib/template-bridge';

interface RouteContext {
  params: Promise<{ tenantSlug: string; cardId: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
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
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    type CardRow = { templateKey: string; title: string; category: string; agency: string | null; format: string; bridgeVersion: number; updateAvailable: boolean; template: unknown };
    let row: CardRow | undefined;
    try {
      // Explicit tenant predicate (belt) + RLS (suspenders): the app connects as the RLS-bypassing
      // owner today, so without the tenant_id filter this could read another tenant's card.
      [row] = await withTenant<CardRow[]>(tenantId, async (tx) => tx`
        SELECT template_key AS "templateKey", title, category, agency, format,
               bridge_version AS "bridgeVersion", update_available AS "updateAvailable", template
        FROM tenant_template_cards
        WHERE id = ${cardId}::uuid AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `);
    } catch (e) {
      console.error('[portal/template-cards/:id] load failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'Template not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const snapshot = coerceJsonb<TemplateSnapshot | null>(row.template, null);
    return NextResponse.json({
      data: {
        card: {
          templateKey: row.templateKey, title: row.title, category: row.category,
          agency: row.agency, format: row.format, bridgeVersion: row.bridgeVersion,
          updateAvailable: row.updateAvailable,
          canvasDocument: snapshot?.canvasDocument ?? null,
        },
      },
    });
  } catch (e) {
    console.error('[portal/template-cards/:id] GET failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
