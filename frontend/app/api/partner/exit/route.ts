/**
 * GET /api/partner/exit — a partner-manager ASCENDS back to their console
 * (docs/PARTNER_MANAGER_DESIGN.md §3b, D2). Restores their real base role + their own-org home and
 * clears the descend flag, then lands on /partner. Authorized off the DB role (the descended
 * session role is tenant_admin).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { auth, unstable_update } from '@/auth';
import { sqlBypass } from '@/lib/db';
import { isRole, canManagePartnerTenants, type Role } from '@/lib/rbac';
import { partnerOwnOrg } from '@/lib/partner/scope';
import { emitEventSingle, userActor } from '@/lib/events';

async function realRole(userId: string): Promise<Role | null> {
  try {
    const [u] = await sqlBypass<{ role: string }[]>`SELECT role FROM users WHERE id = ${userId}::uuid LIMIT 1`;
    return u && isRole(u.role) ? u.role : null;
  } catch { return null; }
}

export async function GET(req: NextRequest) {
  const url = (p: string) => new URL(p, req.nextUrl.origin);
  const session = await auth();
  const u = session?.user as { id?: string; email?: string } | undefined;
  if (!u?.id) return NextResponse.redirect(url('/login'));

  const rr = await realRole(u.id);
  if (!rr || !canManagePartnerTenants(rr)) return NextResponse.redirect(url('/login'));

  try {
    const own = await partnerOwnOrg(u.id);
    await unstable_update({
      user: { role: rr, tenantId: own?.id ?? null, tenantSlug: own?.slug ?? null, partnerHomeRole: null },
    } as unknown as Parameters<typeof unstable_update>[0]);

    try {
      await emitEventSingle({ namespace: 'finder', type: 'partner.exited', actor: userActor(u.id, u.email), tenantId: null, payload: {} });
    } catch { /* best-effort */ }

    return NextResponse.redirect(url('/partner'));
  } catch (e) {
    console.error('[partner/exit] failed:', e);
    // Restore the base role even if the own-org lookup failed, so the partner isn't stuck descended.
    try {
      await unstable_update({ user: { role: rr, tenantId: null, tenantSlug: null, partnerHomeRole: null } } as unknown as Parameters<typeof unstable_update>[0]);
    } catch { /* best-effort */ }
    return NextResponse.redirect(url('/partner'));
  }
}
