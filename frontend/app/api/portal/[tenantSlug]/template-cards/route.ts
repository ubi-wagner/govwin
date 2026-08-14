/**
 * GET /api/portal/[tenantSlug]/template-cards
 *
 * The tenant's OWNED pristine-template shelf — its denormalized template cards
 * (mig 177), read RLS-scoped via withTenant() (SET LOCAL app.tenant_id). Every
 * card is a self-contained snapshot copied forward from the template bridge; no
 * JOIN to the master. Bodies (`template.canvasDocument`) are omitted here (large)
 * — the single-card route serves the body for preview.
 *
 * Optional filter: ?category=  (dod_dow | nsf | doe | marketing | ...).
 * Auth: tenant_user+ with tenant access (RFP/master admin via shadow).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { withTenant } from '@/lib/rls';
import { reconcileTenantTemplates } from '@/lib/template-bridge';

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
    const su = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) {
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
    if (!(await verifyTenantAccess(su.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    // Read-repair: catch this tenant's template shelf up to the bridge head before serving. The
    // forward-only fan-out only reaches tenants that existed at push time, so a tenant created after a
    // push (or whose creation-time backfill failed) would otherwise show a permanently empty shelf.
    // Idempotent + cheap (usually zero missed heads); best-effort so it never blocks the shelf.
    try { await reconcileTenantTemplates(tenantId); } catch (e) { console.error('[portal/template-cards] reconcile (non-fatal)', e); }

    const url = new URL(request.url);
    const category = url.searchParams.get('category');

    try {
      // Explicit tenant predicate (belt) + RLS via withTenant (suspenders): the app runs as
      // `govtech_app`, so RLS scopes the read to the tenant. The explicit tenant_id predicate
      // is the belt / defense-in-depth.
      const cards = await withTenant(tenantId, async (tx) => tx`
        SELECT id, template_id AS "templateId", template_key AS "templateKey", title, category,
               agency, format, bridge_version AS "bridgeVersion", update_available AS "updateAvailable",
               updated_at AS "updatedAt"
        FROM tenant_template_cards
        WHERE tenant_id = ${tenantId}::uuid
          AND (${category}::text IS NULL OR category = ${category})
        ORDER BY category ASC, title ASC
      `);
      return NextResponse.json({ data: { cards } });
    } catch (e) {
      console.error('[portal/template-cards] list failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[portal/template-cards] GET failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
