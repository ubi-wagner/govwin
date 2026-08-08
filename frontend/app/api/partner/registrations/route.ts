/**
 * POST /api/partner/registrations — submit a new client company for RFP-admin approval
 * (docs/PARTNER_MANAGER_DESIGN.md §4 Branch A). Creates an applications(source='partner') row +
 * an rfp_admin triage ToDo. On accept, the company is provisioned and attributed to the partner.
 * Auth: partner_admin (owner-scoped) or rfp_admin+.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isRole, canManagePartnerTenants } from '@/lib/rbac';
import { submitPartnerRegistration } from '@/lib/partner/registration';

function partnerActor(session: unknown): { id: string; email: string | null } | null {
  const u = (session as { user?: { id?: string; email?: string; role?: unknown } } | null)?.user;
  const role = isRole(u?.role) ? u!.role : null;
  if (!u?.id || !role || !canManagePartnerTenants(role)) return null;
  return { id: u.id, email: u.email ?? null };
}

export async function POST(request: Request) {
  try {
    const me = partnerActor(await auth());
    if (!me) return NextResponse.json({ error: 'EconDev partner access required', code: 'FORBIDDEN' }, { status: 403 });

    let body: Record<string, unknown>;
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const optStr = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const result = await submitPartnerRegistration({
      partner: me,
      companyName: str(body.companyName),
      adminName: str(body.adminName),
      adminEmail: str(body.adminEmail),
      adminPhone: optStr(body.adminPhone),
      companyWebsite: optStr(body.companyWebsite),
      companyState: optStr(body.companyState),
      description: str(body.description),
      partnerNotes: optStr(body.partnerNotes),
      dedupDecision: body.dedupDecision === 'confirmed_new' ? 'confirmed_new' : 'clear',
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ data: { applicationId: result.applicationId } }, { status: 201 });
  } catch (e) {
    console.error('[partner/registrations] POST error:', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
