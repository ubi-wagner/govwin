/**
 * GET /api/partner/enter?slug=X — a partner-manager DESCENDS into one of their companies
 * (docs/PARTNER_MANAGER_DESIGN.md §3b, D2). Pins the session as tenant_admin at the target (reusing
 * the fully-tested tenant portal) and carries the partner's real base role so ascend can restore it.
 * Unlike the generic /api/enter, there is NO /go re-login gate between the partner's own companies —
 * they legitimately hold a membership at each, so hopping is smooth.
 *
 * Authorized off the DB role (users.role), not the session role, because a descended partner's
 * session role is already tenant_admin.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { auth, unstable_update } from '@/auth';
import { sqlBypass } from '@/lib/db';
import { isRole, canManagePartnerTenants, type Role } from '@/lib/rbac';
import { partnerCanEnter } from '@/lib/partner/scope';
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

  const slug = req.nextUrl.searchParams.get('slug')?.trim() ?? '';
  if (!slug) return NextResponse.redirect(url('/partner'));

  const [t] = await sqlBypass<{ id: string }[]>`SELECT id FROM tenants WHERE slug = ${slug} AND archived_at IS NULL LIMIT 1`;
  if (!t) return NextResponse.redirect(url('/partner'));
  if (!(await partnerCanEnter(u.id, t.id))) return NextResponse.redirect(url('/partner'));

  await unstable_update({
    user: { role: 'tenant_admin', tenantId: t.id, tenantSlug: slug, partnerHomeRole: rr },
  } as unknown as Parameters<typeof unstable_update>[0]);

  try {
    await emitEventSingle({ namespace: 'finder', type: 'partner.entered', actor: userActor(u.id, u.email), tenantId: t.id, payload: { tenantId: t.id, slug } });
  } catch { /* best-effort */ }

  return NextResponse.redirect(url(`/portal/${slug}/dashboard`));
}
