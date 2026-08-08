/**
 * POST /api/admin/partners — an RFP admin creates a new partner-manager (EconDev org)
 * (docs/PARTNER_MANAGER_DESIGN.md D4). Creates the partner_admin user + their own-org tenant and
 * returns a temp password to relay. Gated at rfp_admin+ (middleware + this re-check).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { createPartnerOrg } from '@/lib/partner/create-partner-org';

export async function POST(request: Request) {
  try {
    const session = await auth();
    const u = session?.user as { id?: string; email?: string; role?: unknown } | undefined;
    const role = isRole(u?.role) ? u.role : null;
    if (!u?.id || !role) return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'rfp_admin')) return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const optStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const result = await createPartnerOrg({
      orgName: str(body.orgName),
      legalName: optStr(body.legalName),
      website: optStr(body.website),
      adminName: str(body.adminName),
      adminEmail: str(body.adminEmail),
      createdBy: { id: u.id, email: u.email ?? null },
    });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({
      data: { userId: result.userId, tenantId: result.tenantId, slug: result.slug, tempPassword: result.tempPassword },
    }, { status: 201 });
  } catch (e) {
    console.error('[admin/partners] POST error:', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
