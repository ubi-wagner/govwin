/**
 * POST /api/partner/tenants/precheck — the add-company dedup check
 * (docs/PARTNER_MANAGER_DESIGN.md §4).
 *
 * Body: { name, adminEmail? }. Returns { verdict, exactExistingTenant, similar[], emailInUseAsAdmin }.
 * Read-only (no writes, no audit — the audited DECISION is captured when the partner submits a
 * registration or a manager request). Auth: partner_admin (owner-scoped) or rfp_admin+.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isRole, canManagePartnerTenants } from '@/lib/rbac';
import { runPrecheck } from '@/lib/partner/precheck';

function isPartner(session: unknown): boolean {
  const u = (session as { user?: { role?: unknown } } | null)?.user;
  const role = isRole(u?.role) ? u!.role : null;
  return !!role && canManagePartnerTenants(role);
}

export async function POST(request: Request) {
  try {
    if (!isPartner(await auth())) {
      return NextResponse.json({ error: 'EconDev partner access required', code: 'FORBIDDEN' }, { status: 403 });
    }
    let body: { name?: unknown; adminEmail?: unknown };
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const adminEmail = typeof body.adminEmail === 'string' ? body.adminEmail.trim().toLowerCase() : '';
    if (!name) {
      return NextResponse.json({ error: 'Company name is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    try {
      const result = await runPrecheck(name, adminEmail);
      return NextResponse.json({ data: result });
    } catch (e) {
      console.error('[partner/precheck] query error:', e);
      return NextResponse.json({ error: 'Precheck failed', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[partner/precheck] POST error:', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
