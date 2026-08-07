/**
 * POST /api/partner/manager-requests — a partner requests manager access to an EXISTING company
 * (docs/PARTNER_MANAGER_DESIGN.md §4 Branch B). Raises a ToDo to that company's admin. Auth:
 * partner_admin (owner-scoped) or rfp_admin+.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isRole, canManagePartnerTenants } from '@/lib/rbac';
import { createManagerRequest } from '@/lib/partner/manager-request';
import { partnerOwnOrg } from '@/lib/partner/scope';

function partnerActor(session: unknown): { id: string; email: string | null; name: string | null } | null {
  const u = (session as { user?: { id?: string; email?: string; name?: string; role?: unknown } } | null)?.user;
  const role = isRole(u?.role) ? u!.role : null;
  if (!u?.id || !role || !canManagePartnerTenants(role)) return null;
  return { id: u.id, email: u.email ?? null, name: u.name ?? null };
}

export async function POST(request: Request) {
  try {
    const me = partnerActor(await auth());
    if (!me) return NextResponse.json({ error: 'EconDev partner access required', code: 'FORBIDDEN' }, { status: 403 });

    let body: { tenantId?: unknown };
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const tenantId = typeof body.tenantId === 'string' ? body.tenantId.trim() : '';
    if (!tenantId) return NextResponse.json({ error: 'A company is required', code: 'VALIDATION_ERROR' }, { status: 400 });

    // Identify the requester by their org name (nicer than the person's name in the company's ToDo).
    let orgName = me.name;
    try { orgName = (await partnerOwnOrg(me.id))?.name ?? me.name; } catch { /* fall back to the person */ }

    const result = await createManagerRequest({ partner: { ...me, name: orgName }, tenantId });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ data: { taskId: result.taskId, assignedTo: result.assignedTo } }, { status: 201 });
  } catch (e) {
    console.error('[partner/manager-requests] POST error:', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
