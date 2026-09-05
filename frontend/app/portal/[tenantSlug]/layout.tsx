import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, canManageBuckets } from '@/lib/db';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { PortalNavLink } from '@/components/portal/portal-nav-link';
import { NotificationBell } from '@/components/portal/notification-panel';
import { ShadowSpaceBanner } from '@/components/portal/shadow-space-banner';
import { syncPortalPresence, idleDescent, closePresence, noteInteraction, inForcedCooldown } from '@/lib/space-presence';
import { DESCENT_IDLE_MS } from '@/lib/session-policy';
import { PresenceHeartbeat } from '@/components/portal/presence-heartbeat';
import { getActiveMemberships, hasActiveMembership } from '@/lib/memberships';
import { NavShell } from '@/components/ui/nav-shell';
import type { Metadata } from 'next';

// Per-tenant tab title — every portal page reads "<Company> · RFP Pipeline" unless the
// page sets its own; a page-level title overrides this. Fixes the all-"RFP Pipeline" tabs.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}): Promise<Metadata> {
  try {
    const { tenantSlug } = await params;
    const tenant = await getTenantBySlug(tenantSlug);
    return { title: (tenant?.name as string) || 'Portal' };
  } catch {
    return { title: 'Portal' };
  }
}

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
    email?: string | null;
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

  /**
   * THE OPEN HALF OF THE BRACKET, recorded by the SERVER on every render inside the space.
   *
   * Previously the descend event came from a client component's `useEffect`, deduped in
   * `sessionStorage` — per TAB, so a second tab opened a second bracket. And nothing recorded that
   * the actor was still here, so nothing could ever tell an abandoned session from a long one.
   *
   * This also closes the "moved" case in the same call: a manager who goes from company A straight
   * into company B passes no exit control, and A is owed a departure. `syncPortalPresence` opens
   * the current one and closes every other, which is only knowable from inside a render that has
   * just established which tenant this is.
   *
   * Deliberately NOT awaited into the render path's critical section beyond its own try/catch — it
   * is best-effort inside the helper, because an audit write must never take a customer's page
   * down. The hourly sweep is the backstop for anything it misses.
   */
  const outsideKind = isShadowAdmin ? 'shadow' : isDescendedPartner ? 'partner' : null;

  /**
   * THE DESCENT IDLE GATE — checked BEFORE the bracket is synced, and that order matters.
   *
   * `syncPortalPresence` advances liveness, so running it first would refresh the very value this
   * reads and the gate could never fire. Same shape as the ordering bug in the `jwt` callback, one
   * layer up.
   *
   * WHY A GATE AND NOT A STATE RESET. An rfp_admin has nothing to ascend FROM: `isShadowAdmin` is
   * computed per render as "is an admin AND is not a member here", so being on this URL *is* the
   * descent. There is no flag to clear, which is why the sweep — which closes the ROW — never
   * removed anybody's access. Refusing here is the only thing that does.
   *
   * The bracket is closed as `timeout` on the way out so the customer's trail records the departure
   * at the moment access actually ended, rather than up to an hour later when the sweep runs.
   */
  if (outsideKind) {
    /**
     * A FORCED ASCENT holds by TIME, and is checked before the idle rule.
     *
     * Closing a bracket evicts the RECORD, not the actor: `isShadowAdmin` is recomputed every
     * render, so the target's next page load simply opens a new one. Without this line the
     * "End access" button on /admin/workspace-access looks like it worked and removes nobody —
     * which is worse than not having the button, because an operator would trust it.
     *
     * Proven by `drive-force-ascend.mts` check 3: with this absent, the target walks straight back
     * in while checks 1, 2, 4 and 5 all pass.
     */
    if (await inForcedCooldown(userId, tenantId)) {
      redirect(isShadowAdmin ? '/admin/dashboard?descent=forced' : '/partner?descent=forced');
    }
    const idle = await idleDescent(userId, tenantId, DESCENT_IDLE_MS / 60_000);
    if (idle) {
      // No `exceptTenantId`: an idle person is idle everywhere, so every open bracket they hold
      // closes. In practice `syncPortalPresence` keeps that to one, but a timeout that left a
      // second workspace asserting a presence would be the same defect one company over.
      await closePresence({ id: userId, email: sessionUser.email }, 'timeout');
      // `/admin/dashboard`, NOT `/admin`: the latter is a bare `redirect('/admin/dashboard')` and a
      // redirect DROPS the query string, so the person arrived with no idea why they had been
      // moved. The drive caught exactly that — "no reason is carried" — which is why the reason
      // travels to the page that actually renders.
      redirect(isShadowAdmin ? '/admin/dashboard?descent=timeout' : '/partner?descent=timeout');
    }
  }

  await syncPortalPresence(
    { id: userId, email: sessionUser.email },
    tenantId,
    outsideKind,
    { slug: tenantSlug },
  );

  // A person navigated INSIDE the space — advance the interaction clock the gate above reads.
  // Deliberately after the sync, and deliberately not in the heartbeat route.
  if (outsideKind) await noteInteraction({ id: userId, email: sessionUser.email });

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
  // A delegated designee (tenant_user + can_manage_buckets, mig 181) also reaches Opportunities + Buckets.
  const canManageBucketsHere = isTenantAdmin || (await canManageBuckets(userId, role, tenantId));

  return (
    <NavShell
      brand={companyName}
      rail={<>
        <div className="flex-1 min-h-0">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold truncate">{companyName}</h2>
            {/* B2/H1: a partner_user gets a bell too — the feed is collaborator-scoped server-side. */}
            <NotificationBell tenantSlug={tenantSlug} />
          </div>
          <p className="text-xs text-gray-400 mb-6 truncate">{userName}</p>
          {/* Flat, slim nav (Step 0 of the unified-canvas plan — de-compartmentalized; the
              cockpit/dashboard is the visual home, the rail is just navigation). A hairline
              separates the daily surfaces from the setup tail; no uppercase section headers. */}
          <nav className="flex flex-col gap-1 text-sm">
            {/* Command Center — the tabbed "what needs me → act" console (Opportunities · To-dos ·
                Workflows · Activity). The admin front door; a base member lands on the cockpit. */}
            {isTenantAdmin && <PortalNavLink href={`${basePath}/command`}>Command Center</PortalNavLink>}
            {!isPartner && <PortalNavLink href={`${basePath}/dashboard`}>Dashboard</PortalNavLink>}
            {canManageBucketsHere && <PortalNavLink href={`${basePath}/cards`}>Opportunities</PortalNavLink>}
            {canManageBucketsHere && <PortalNavLink href={`${basePath}/buckets`}>Buckets</PortalNavLink>}
            <PortalNavLink href={`${basePath}/proposals`}>Proposals</PortalNavLink>
            {isTenantAdmin && <PortalNavLink href={`${basePath}/portals`}>Builds</PortalNavLink>}
            {/* Contracts — the awards won. Without this the entity was reachable ONLY through the
                contract_kickoff ToDo's deep-link, so dismissing that ToDo lost it (bug log B50). */}
            {!isPartner && <PortalNavLink href={`${basePath}/contracts`}>Contracts</PortalNavLink>}
            {/* Projects — post-award execution: CLINs, schedule, deliverables. Hidden from
                partner_user because Projects v1 has no collaborator surface at all (which is what
                removes cross-tenant from the capability); a plain tenant_user sees the link and a
                list scoped to what they are ASSIGNED, which may be empty. Showing the link to an
                unassigned employee is deliberate — an empty list with an explanation beats a
                missing rail item, which reads as "this company does not run projects". */}
            {!isPartner && <PortalNavLink href={`${basePath}/projects`}>Projects</PortalNavLink>}
            {!isPartner && <PortalNavLink href={`${basePath}/atoms`}>Library</PortalNavLink>}
            {/* Collaboration vaults ("nooks") — segregated per-partner branch libraries (admin). */}
            {isTenantAdmin && <PortalNavLink href={`${basePath}/vaults`}>Vaults</PortalNavLink>}
            {/* A partner_user reaches THEIR own nooks at the top-level /vaults (list is self-scoped;
                empty state if none) — without this a partner with both a nook AND proposal access had
                no path to their vault. */}
            {isPartner && <PortalNavLink href="/vaults">Collaboration vaults</PortalNavLink>}
            <PortalNavLink href={`${basePath}/todos`}>To-dos</PortalNavLink>
            {!isPartner && (
              <>
                <PortalNavLink href={`${basePath}/processes`}>Processes</PortalNavLink>
                {/* Activity firehose is admin-only (tenant_admin+) — matches the page guard. */}
                {isTenantAdmin && <PortalNavLink href={`${basePath}/activity`}>Activity</PortalNavLink>}
                <PortalNavLink href={`${basePath}/team`}>Team</PortalNavLink>
                <PortalNavLink href={`${basePath}/documents`}>Documents</PortalNavLink>
                <PortalNavLink href={`${basePath}/templates`}>Templates</PortalNavLink>
              </>
            )}
            {/* Setup tail — separated by a hairline, not a labeled section. */}
            {!isPartner && (
              <>
                <div className="my-2 border-t border-white/10" />
                {isTenantAdmin && <PortalNavLink href={`${basePath}/manage`}>Manage</PortalNavLink>}
                {isTenantAdmin && <PortalNavLink href={`${basePath}/billing`}>Billing</PortalNavLink>}
                {isTenantAdmin && <PortalNavLink href={`${basePath}/agents`}>AI Usage</PortalNavLink>}
                {isTenantAdmin && <PortalNavLink href={`${basePath}/automation`}>Automation</PortalNavLink>}
                <PortalNavLink href={`${basePath}/profile`}>Settings</PortalNavLink>
              </>
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
      {/* Liveness for the bracket this render opened. Only an OUTSIDE actor holds one, so a normal
          customer session mounts nothing and pings nothing. Without it the sweep evicts an actor
          who is still here — a soft navigation does not re-run this layout. */}
      {(isShadowAdmin || isDescendedPartner) && <PresenceHeartbeat />}
      <div className="p-4 sm:p-6 lg:p-8">{children}</div>
    </NavShell>
  );
}
