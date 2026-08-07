/**
 * POST /api/portal/[tenantSlug]/manager-requests/[taskId] — the company admin's decision on a
 * partner's manager-access request (docs/PARTNER_MANAGER_DESIGN.md §4 Branch B).
 * Body: { action: 'approve' | 'decline' }. Approve grants the partner a partner_manager membership.
 * Auth: tenant_admin (or higher) of THIS company.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { resolveManagerRequest } from '@/lib/partner/manager-request';
import { isValidUUID } from '@/lib/validation';

interface Ctx { params: Promise<{ tenantSlug: string; taskId: string }> }

export async function POST(request: Request, ctx: Ctx) {
  try {
    const session = await auth();
    const u = session?.user as { id?: string; email?: string; role?: unknown } | undefined;
    const role = isRole(u?.role) ? u.role : null;
    if (!u?.id || !role) return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    // Only a company admin (or platform admin) resolves a manager request.
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug, taskId } = await ctx.params;
    if (!isValidUUID(taskId)) return NextResponse.json({ error: 'Invalid request id', code: 'VALIDATION_ERROR' }, { status: 400 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Company not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) {
      return NextResponse.json({ error: 'Company access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { action?: unknown };
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const action = body.action === 'approve' ? 'approve' : body.action === 'decline' ? 'decline' : null;
    if (!action) return NextResponse.json({ error: 'action must be approve or decline', code: 'VALIDATION_ERROR' }, { status: 400 });

    const result = await resolveManagerRequest({
      taskId, tenantId, approver: { id: u.id, email: u.email ?? null }, decision: action,
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ data: { granted: result.granted } });
  } catch (e) {
    console.error('[portal/manager-requests] POST error:', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
