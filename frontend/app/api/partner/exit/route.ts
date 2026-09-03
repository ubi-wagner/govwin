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
import { closePresence } from '@/lib/space-presence';

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
    /**
     * CLOSE THE BRACKET BEFORE THE SESSION FORGETS WHICH COMPANY IT WAS.
     *
     * This route used to emit `partner.exited` with `tenantId: null` — so the departure landed in
     * NO customer's audit trail, and the company that had been entered saw the arrival with no
     * matching close. The tenant was right here in the session the whole time; it was simply not
     * read. `closePresence` finds the open bracket by actor and closes it with the tenant it
     * actually belongs to, so this works even if the session has already been rewritten below.
     */
    await closePresence({ id: u.id, email: u.email }, 'explicit');

    const own = await partnerOwnOrg(u.id);
    // Ascending RELEASES the company commitment that descending made: /api/partner/enter sets
    // membershipPinned, and leaving it set would weld the manager to the company they just left —
    // the portal layout denies any other tenant while a session is pinned elsewhere.
    await unstable_update({
      user: { role: rr, tenantId: own?.id ?? null, tenantSlug: own?.slug ?? null, partnerHomeRole: null, membershipPinned: false },
    } as unknown as Parameters<typeof unstable_update>[0]);

    return NextResponse.redirect(url('/partner'));
  } catch (e) {
    console.error('[partner/exit] failed:', e);
    // Restore the base role even if the own-org lookup failed, so the partner isn't stuck descended.
    try {
      await unstable_update({ user: { role: rr, tenantId: null, tenantSlug: null, partnerHomeRole: null, membershipPinned: false } } as unknown as Parameters<typeof unstable_update>[0]);
    } catch { /* best-effort */ }
    return NextResponse.redirect(url('/partner'));
  }
}
