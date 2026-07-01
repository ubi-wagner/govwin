/**
 * GET /api/portal/[tenantSlug]/section-standards
 *
 * Tenant-accessible read of the canonical section-standards taxonomy (the admin
 * CRUD endpoint at /api/admin/section-standards is rfp_admin+ only). Portal
 * surfaces — the canvas atomization rail, the library review rail — need the same
 * {key,label} vocabulary to classify atoms, so this exposes a read-only view to any
 * tenant_user with tenant access. The taxonomy is global, non-sensitive.
 *
 * Returns: { data: { standards: [{ key, label, category }] } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

export async function GET(
  _request: Request,
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
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenant.id as string);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    try {
      const standards = await sql<Array<{ key: string; label: string; category: string | null }>>`
        SELECT key, label, category
        FROM section_standards
        WHERE is_active IS NOT false
        ORDER BY sort_order NULLS LAST, label
      `;
      return NextResponse.json({ data: { standards } });
    } catch (e) {
      console.error('[portal/section-standards] query failed', e);
      return NextResponse.json({ error: 'Failed to load standards', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (err) {
    console.error('[portal/section-standards] error', err);
    return NextResponse.json({ error: 'Failed to load standards', code: 'DB_ERROR' }, { status: 500 });
  }
}
