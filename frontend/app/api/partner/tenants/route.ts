/**
 * GET  /api/partner/tenants — the partner console model: the partner's OWN org + their STABLE
 *      (owned/managed client companies) with rollup stats. Owner-scoped — a partner never sees
 *      another partner's stable.
 * POST /api/partner/tenants — RETIRED (410). Company creation is now approval-gated (D3): a
 *      partner submits a registration (POST /api/partner/registrations) that an RFP admin approves,
 *      which provisions the tenant and attributes it to the partner. Direct instant-create is
 *      closed so the approval gate can't be bypassed (design invariant #1).
 *
 * Auth: partner_admin (owner-scoped) or rfp_admin+. partner_admin is denied /admin by rank.
 * See docs/PARTNER_MANAGER_DESIGN.md.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { enterBypass } from '@/lib/db';
import { isRole, canManagePartnerTenants, type Role } from '@/lib/rbac';
import { partnerOwnOrg, partnerScopeTenants } from '@/lib/partner/scope';
import { tenantRollupStats } from '@/lib/partner/rollup';

function actor(session: any): { id: string; email: string | null; role: Role } | null {
  const u = session?.user as { id?: string; email?: string; role?: unknown } | undefined;
  const role = isRole(u?.role) ? u!.role : null;
  if (!u?.id || !role || !canManagePartnerTenants(role)) return null;
  return { id: u.id, email: u.email ?? null, role };
}

export async function GET() {
  try {
    const me = actor(await auth());
    if (!me) return NextResponse.json({ error: 'EconDev partner access required', code: 'FORBIDDEN' }, { status: 403 });
    enterBypass();
    try {
      // The console model: the partner's OWN org + their STABLE (client companies they own or
      // manage), each with rollup stats. Owner-scoped — a partner never sees another's stable.
      const ownOrg = await partnerOwnOrg(me.id);
      const stable = await partnerScopeTenants(me.id);
      const rollup = await tenantRollupStats([...(ownOrg ? [ownOrg.id] : []), ...stable.map((t) => t.id)]);
      const shape = (t: { id: string; slug: string; name: string; kind: string; relation: 'owner' | 'manager' }) => {
        const s = rollup.get(t.id);
        return {
          id: t.id, slug: t.slug, name: t.name, kind: t.kind, relation: t.relation,
          buckets: s?.buckets ?? 0, pins: s?.pins ?? 0, proposals: s?.proposals ?? 0,
          portals: s?.portals ?? 0, adminPocEmail: s?.adminPocEmail ?? null, adminPocName: s?.adminPocName ?? null,
        };
      };
      return NextResponse.json({ data: { ownOrg: ownOrg ? shape(ownOrg) : null, tenants: stable.map(shape) } });
    } catch (e) {
      console.error('[partner/tenants/list] error:', e);
      return NextResponse.json({ error: 'Query failed', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[partner/tenants] GET error:', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST() {
  // Retired: creation is approval-gated (D3, invariant #1). Instant-create is closed so the RFP
  // approval gate can't be bypassed — partners submit POST /api/partner/registrations instead.
  return NextResponse.json(
    { error: 'Company creation is approval-gated. Submit a registration via /api/partner/registrations.', code: 'GONE' },
    { status: 410 },
  );
}
