import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { ManageConsole, type ManageMember, type ManagePurchase } from '@/components/portal/manage-console';

export const dynamic = 'force-dynamic';

/**
 * Manage console — the tenant-admin (and descended shadow-admin) setup/governance
 * surface. "Page 2" of the admin experience. Server component: gates, loads the
 * account/members/counts data (mirrors billing/profile/team pages), then hands off to
 * the ManageConsole client shell. See docs/CUSTOMER_ADMIN_CONSOLE_DESIGN.md.
 */
export default async function ManagePage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');

  const sessionUser = session.user as { id?: string; role?: unknown; tenantId?: string | null };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');

  // tenant_admin floor — admits a descended shadow admin (rfp_admin/master_admin keep
  // their rank ≥ tenant_admin), excludes base tenant_user / partner_user. Middleware only
  // enforces the coarse /portal floor, so this page must gate itself.
  if (!hasRoleAtLeast(role, 'tenant_admin')) {
    redirect(`/portal/${tenantSlug}/dashboard`);
  }

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/portal');
  enterTenant(tenantId);

  const companyName = (tenant.name as string) ?? tenantSlug;
  const isExpert = role === 'rfp_admin' || role === 'master_admin';

  // ── Account: subscription + billing ────────────────────────────────
  let subscriptionStatus = 'none';
  let hasStripeCustomer = false;
  try {
    const [b] = await sql<{ subscriptionStatus: string; stripeCustomerId: string | null }[]>`
      SELECT subscription_status, stripe_customer_id FROM tenants WHERE id = ${tenantId}
    `;
    if (b) { subscriptionStatus = b.subscriptionStatus ?? 'none'; hasStripeCustomer = !!b.stripeCustomerId; }
  } catch (e) { console.error('[manage] subscription query failed', e); }

  let purchases: ManagePurchase[] = [];
  try {
    purchases = await sql<ManagePurchase[]>`
      SELECT id, product_type, amount_cents, status, created_at, opportunity_id
      FROM purchases WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC LIMIT 50
    `;
  } catch (e) { console.error('[manage] purchases query failed', e); }

  // ── Account: company info + profile ────────────────────────────────
  interface TenantInfo {
    name: string; legalName: string | null; website: string | null; billingEmail: string | null;
    productTier: string; createdAt: Date;
  }
  let tenantInfo: TenantInfo | null = null;
  try {
    const [row] = await sql<TenantInfo[]>`
      SELECT name, legal_name, website, billing_email, product_tier, created_at
      FROM tenants WHERE id = ${tenantId}
    `;
    tenantInfo = row ?? null;
  } catch (e) { console.error('[manage] tenant info query failed', e); }

  interface TenantProfile {
    naicsCodes: string[]; keywords: string[]; agencyPriorities: string[]; setAsideTypes: string[];
    technologyFocus: string | null; companySummary: string | null; researchAreas: string[]; targetAgencies: string[];
  }
  let profile: TenantProfile | null = null;
  try {
    const [row] = await sql<TenantProfile[]>`
      SELECT naics_codes, keywords, agency_priorities, set_aside_types,
             technology_focus, company_summary, research_areas, target_agencies
      FROM tenant_profiles WHERE tenant_id = ${tenantId}
    `;
    profile = row ?? null;
  } catch (e) { console.error('[manage] profile query failed', e); }

  // ── Users: team members (home/manual memberships) ──────────────────
  let members: ManageMember[] = [];
  try {
    members = await sql<ManageMember[]>`
      SELECT u.id, u.name, u.email, m.role, (m.status = 'active') AS is_active, u.last_login_at
      FROM user_memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.tenant_id = ${tenantId} AND m.source IN ('home', 'manual')
      ORDER BY
        CASE m.role WHEN 'tenant_admin' THEN 0 WHEN 'tenant_user' THEN 1 ELSE 2 END,
        u.created_at ASC
    `;
  } catch (e) { console.error('[manage] members query failed', e); }

  // ── Lifecycle counts ───────────────────────────────────────────────
  const count = async (label: string, q: Promise<{ n: string }[]>): Promise<number> => {
    try { const [r] = await q; return parseInt(r?.n ?? '0', 10); }
    catch (e) { console.error(`[manage] ${label} count failed`, e); return 0; }
  };
  const [buckets, opps, portals, proposals, tasks, library] = await Promise.all([
    count('buckets', sql`SELECT COUNT(*)::text AS n FROM tenant_spotlight_buckets WHERE tenant_id = ${tenantId} AND is_active = true`),
    count('opps', sql`SELECT COUNT(*)::text AS n FROM tenant_opportunity_cards WHERE tenant_id = ${tenantId} AND lifecycle_status <> 'archived'`),
    count('portals', sql`SELECT COUNT(*)::text AS n FROM proposal_portals WHERE tenant_id = ${tenantId}`),
    count('proposals', sql`SELECT COUNT(*)::text AS n FROM proposals WHERE tenant_id = ${tenantId} AND stage NOT IN ('archived','submitted')`),
    count('tasks', sql`SELECT COUNT(*)::text AS n FROM tasks WHERE tenant_id = ${tenantId} AND status IN ('open','in_progress')`),
    count('library', sql`SELECT COUNT(*)::text AS n FROM library_atoms WHERE tenant_id = ${tenantId}`),
  ]);

  const canEdit = role === 'tenant_admin' || role === 'master_admin' || role === 'rfp_admin';
  const memberSince = tenantInfo
    ? new Date(tenantInfo.createdAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;

  return (
    <ManageConsole
      tenantSlug={tenantSlug}
      companyName={companyName}
      role={role}
      currentUserId={sessionUser.id}
      isExpert={isExpert}
      counts={{ buckets, opps, portals, proposals, tasks, library }}
      account={{
        subscriptionStatus,
        hasStripeCustomer,
        purchases: purchases.map((p) => ({
          id: p.id, productType: p.productType, amountCents: p.amountCents,
          status: p.status, createdAt: p.createdAt, opportunityId: p.opportunityId,
        })),
        canEdit,
        // Stripe checkout/portal act on the SESSION's tenant; only the company's own
        // admin (session tenant === this tenant) may drive them. A descended shadow
        // admin sees the state read-only. (Comp-code purchase is the live path anyway.)
        canManageBilling: sessionUser.tenantId === tenantId,
        productTier: tenantInfo?.productTier ?? 'trial',
        memberSince,
        tenantInfo: tenantInfo ? {
          name: tenantInfo.name, legalName: tenantInfo.legalName,
          website: tenantInfo.website, billingEmail: tenantInfo.billingEmail,
        } : null,
        profile: profile ? {
          naicsCodes: profile.naicsCodes ?? [], keywords: profile.keywords ?? [],
          technologyFocus: profile.technologyFocus, companySummary: profile.companySummary,
          researchAreas: profile.researchAreas ?? [], targetAgencies: profile.targetAgencies ?? [],
          setAsideTypes: profile.setAsideTypes ?? [], agencyPriorities: profile.agencyPriorities ?? [],
        } : null,
      }}
      members={members}
    />
  );
}
