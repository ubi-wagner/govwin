import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { PortalNavLink } from '@/components/portal/portal-nav-link';
import { NotificationBell } from '@/components/portal/notification-panel';

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
  };

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
    redirect('/login');
  }

  const tenantId = tenant.id as string;
  const hasAccess = await verifyTenantAccess(userId, role, tenantId);
  if (!hasAccess) {
    redirect('/login');
  }

  const companyName = (tenant.name as string) ?? tenantSlug;
  const userName = sessionUser.name ?? sessionUser.id ?? '';

  const basePath = `/portal/${tenantSlug}`;
  const isPartner = role === 'partner_user';

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-navy-900 text-white p-6 flex flex-col justify-between">
        <div>
          <h2 className="text-lg font-bold mb-1 truncate">{companyName}</h2>
          <p className="text-xs text-gray-400 mb-6 truncate">{userName}</p>
          <nav className="flex flex-col gap-1 text-sm">
            {!isPartner && (
              <>
                <PortalNavLink href={`${basePath}/dashboard`}>Dashboard</PortalNavLink>
                <PortalNavLink href={`${basePath}/spotlights`}>Spotlight</PortalNavLink>
                <PortalNavLink href={`${basePath}/pipeline`}>Pipeline</PortalNavLink>
                <PortalNavLink href={`${basePath}/library`}>Library</PortalNavLink>
              </>
            )}
            <PortalNavLink href={`${basePath}/proposals`}>Proposals</PortalNavLink>
            {!isPartner && (
              <>
                <PortalNavLink href={`${basePath}/activity`}>Activity</PortalNavLink>
                <PortalNavLink href={`${basePath}/team`}>Team</PortalNavLink>
                <PortalNavLink href={`${basePath}/documents`}>Documents</PortalNavLink>
                <PortalNavLink href={`${basePath}/billing`}>Billing</PortalNavLink>
              </>
            )}
            <PortalNavLink href={`${basePath}/profile`}>Settings</PortalNavLink>
          </nav>
        </div>
        <form action="/api/auth/signout" method="POST" className="mt-8">
          <button
            type="submit"
            className="text-xs text-gray-400 hover:text-white"
          >
            Sign out
          </button>
        </form>
      </aside>
      <main className="flex-1 p-8">
        <div className="flex justify-end mb-4">
          <NotificationBell tenantSlug={tenantSlug} />
        </div>
        {children}
      </main>
    </div>
  );
}
