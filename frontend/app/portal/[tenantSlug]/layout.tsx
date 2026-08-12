import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { PortalNavLink } from '@/components/portal/portal-nav-link';
import { NotificationBell } from '@/components/portal/notification-panel';
import { ShadowSpaceBanner } from '@/components/portal/shadow-space-banner';
import { getActiveMemberships, hasActiveMembership } from '@/lib/memberships';
import { NavShell } from '@/components/ui/nav-shell';

/**
 * Portal layout — server component with auth + tenant access check.
 *
 * Verifies the logged-in user belongs to this tenant (or is an admin)
 * before rendering the sidebar + children. Unauthorized visitors are
 * redirected to /login.
 */
export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) {
    redirect('/login');
  }

  const sessionUser = session.user as {
    id?: string;
    name?: string | null;
    role?: unknown;
    tenantId?: string | null;
    membershipPinned?: boolean;
    partnerHomeRole?: string | null;
  };
  // A partner-manager descended into one of their companies (session pinned to tenant_admin, real
  // base role carried on partnerHomeRole). Shows the "Exit to console" chrome. See PARTNER_MANAGER_DESIGN §3b.
  const isDescendedPartner = sessionUser.partnerHomeRole === 'partner_admin';

  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role) {
    redirect('/login?error=session');
  }

  const userId = sessionUser.id;
  if (!userId) {
    redirect('/login?error=session');
  }

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    // Tenant slug is invalid or tenant was deleted — send to dispatcher
    // which shows "no workspace" message. Do NOT redirect to /login
    // or it creates an infinite loop (user is authenticated but their
    // JWT still has the old tenantSlug).
    redirect('/portal');
  }

  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(userId, role, tenantId);
  if (!hasAccess) {
    redirect('/portal');
  }

  const isAdmin = role === 'rfp_admin' || role === 'master_admin';
  // An RFP/master admin is SHADOWING only in a tenant where they are NOT a real member.
  // Our own RFP Pipeline tenant (staff hold home memberships there, mig 114) is their real
  // workspace, so the shadow banner is suppressed there. Admins are the only accounts that
  // re-scope in-session, so they're EXEMPT from the singular-session pin either way.
  const isShadowAdmin = isAdmin && !(await hasActiveMembership(userId, tenantId));

  // Singular-session enforcement (non-admins). A session acts as exactly ONE
  // (company, role); the active membership is pinned onto the JWT when the user picks
  // it at /select-company. See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
  if (!isAdmin) {
    const pinned = sessionUser.membershipPinned === true;
    const activeTenantId = sessionUser.tenantId ?? null;
    if (pinned) {
      // Committed to one company → any OTHER tenant is a cross-tenant hop; deny it.
      // /select-company is re-pick-proof and forwards back to the pinned company.
      if (activeTenantId && activeTenantId !== tenantId) redirect('/select-company');
    } else {
      // Not yet committed. Force a deliberate pick ONLY when there's a real choice
      // (>1 active company) so two tenants can't be open at once; single-membership
      // users run with nothing to choose (zero friction).
      const memberships = await getActiveMemberships(userId);
      if (memberships.length > 1) redirect('/select-company');
    }
  }

  const companyName = (tenant.name as string) ?? tenantSlug;
  const userName = sessionUser.name ?? sessionUser.id ?? '';

  const basePath = `/portal/${tenantSlug}`;
  const isPartner = role === 'partner_user';
  const isTenantAdmin = hasRoleAtLeast(role, 'tenant_admin');

  return (
    <NavShell
      brand={companyName}
      rail={<>
        <div className="flex-1 min-h-0">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold truncate">{companyName}</h2>
            {!isPartner && <NotificationBell tenantSlug={tenantSlug} />}
          </div>
          <p className="text-xs text-gray-400 mb-6 truncate">{userName}</p>
          <nav className="flex flex-col gap-1 text-sm">
            {!isPartner && (
              <>
                <PortalNavLink href={`${basePath}/dashboard`}>Dashboard</PortalNavLink>
                {/* Admin console ("Page 2") — the setup/governance hub. Same
                    tenant_admin floor as the other admin surfaces (serves a
                    descended shadow admin via rank). */}
                {isTenantAdmin && <PortalNavLink href={`${basePath}/manage`}>Manage</PortalNavLink>}
                {/* BD surfaces — delegated authority, gated to tenant_admin to
                    match the cockpit's grant model (a base tenant_user does not
                    see Opportunities/Buckets/Builds). */}
                {isTenantAdmin && <PortalNavLink href={`${basePath}/cards`}>Opportunities</PortalNavLink>}
                {isTenantAdmin && <PortalNavLink href={`${basePath}/buckets`}>Buckets</PortalNavLink>}
                <PortalNavLink href={`${basePath}/atoms`}>Library</PortalNavLink>
                {/* Collaboration vaults ("nooks") — segregated per-partner branch
                    libraries. tenant_admin only (manage members + harvest). */}
                {isTenantAdmin && <PortalNavLink href={`${basePath}/vaults`}>Vaults</PortalNavLink>}
                {isTenantAdmin && <PortalNavLink href={`${basePath}/portals`}>Builds</PortalNavLink>}
              </>
            )}
            <PortalNavLink href={`${basePath}/proposals`}>Proposals</PortalNavLink>
            {/* A direct ToDo surface for every role — the only ToDo view a partner_user has (they
                have no cockpit drawer); tenant users also keep the cockpit drawer. */}
            <PortalNavLink href={`${basePath}/todos`}>To-dos</PortalNavLink>
            {!isPartner && (
              <>
                <PortalNavLink href={`${basePath}/processes`}>Processes</PortalNavLink>
                <PortalNavLink href={`${basePath}/activity`}>Activity</PortalNavLink>
                <PortalNavLink href={`${basePath}/team`}>Team</PortalNavLink>
                <PortalNavLink href={`${basePath}/documents`}>Documents</PortalNavLink>
                {isTenantAdmin && <PortalNavLink href={`${basePath}/billing`}>Billing</PortalNavLink>}
                {isTenantAdmin && (
                  <PortalNavLink href={`${basePath}/agents`}>AI Usage</PortalNavLink>
                )}
                {isTenantAdmin && (
                  <PortalNavLink href={`${basePath}/automation`}>Automation</PortalNavLink>
                )}
              </>
            )}
            {!isPartner && (
              <PortalNavLink href={`${basePath}/profile`}>Settings</PortalNavLink>
            )}
          </nav>
        </div>
        <div className="mt-8">
          <SignOutButton className="text-xs text-gray-400 hover:text-white" />
        </div>
      </>}
    >
      {isDescendedPartner && (
        <div className="bg-navy-900 text-white px-6 py-2 text-sm flex items-center justify-between gap-4">
          <span>Managing <strong>{companyName}</strong> as a partner-manager.</span>
          <a href="/api/partner/exit" className="underline hover:no-underline whitespace-nowrap">Exit to partner console →</a>
        </div>
      )}
      {isShadowAdmin && <ShadowSpaceBanner companyName={companyName} tenantId={tenantId} />}
      <div className="p-8">{children}</div>
    </NavShell>
  );
}
