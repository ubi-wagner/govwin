import { Fragment } from 'react';
import { auth } from '@/auth';
import { AdminNavLink } from '@/components/admin/admin-nav-link';
import { AdminNavProvider } from '@/components/admin/admin-nav-context';
import { AdminNavTrail } from '@/components/admin/admin-nav-trail';
import { visibleAdminNav } from '@/components/admin/admin-nav-data';
import { isRole, type Role } from '@/lib/rbac';
import { NavShell } from '@/components/ui/nav-shell';
import { closePresence } from '@/lib/space-presence';

export const metadata = { title: 'Admin' };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Filter the rail by what this actor may actually reach. ADMIN_NAV was rendered whole to every
  // admin, so an rfp_admin saw "System Health" (/admin/system is master_admin-only in BOTH
  // lib/rbac.ts and the page itself) and clicking it hit middleware's deny → redirect('/'), i.e.
  // ejected out of the console onto the public marketing site with no message. A nav entry that
  // throws you off the product is worse than no entry.
  //
  // The filter is DERIVED from requiredRoleForPath — the same table middleware enforces — rather
  // than a second minRole field to keep in sync. One authority, no drift.
  const session = await auth();
  const su = session?.user as { id?: string; email?: string | null; role?: unknown } | undefined;
  const role: Role | null = isRole(su?.role) ? su.role : null;
  const nav = visibleAdminNav(role);

  /**
   * THEY TRAVERSED BACK UP AND OUT — close any customer workspace still held open.
   *
   * Rendering the platform console is proof the actor is no longer inside a tenant's space, and it
   * is the ONLY proof that does not depend on them pressing something. `shadow.ascended` used to
   * come exclusively from a "Return to platform" button posted by a client component, so an admin
   * who typed a URL, followed a nav link, or closed the tab left the customer's audit trail saying
   * they were still in there — permanently.
   *
   * This is the "left_space" reason specifically: distinct from pressing exit, from moving to
   * another company, and from being timed out, because a customer reading their own trail should
   * be told which of those four actually happened.
   */
  if (su?.id) {
    await closePresence({ id: su.id, email: su.email }, 'left_space');
  }
  return (
    <AdminNavProvider>
    <NavShell
      brand="RFP Admin"
      mainClassName="flex-1 min-w-0 overflow-x-clip p-4 sm:p-8 bg-gray-50 min-h-screen"
      rail={<>
        <AdminNavLink href="/admin/dashboard">
          <span className="text-lg font-bold">RFP Admin</span>
        </AdminNavLink>

        {/* Rendered from ADMIN_NAV — the single source shared with the breadcrumb (admin-nav-data.ts).
            A grouped item (children) shows its primary link with the secondaries indented beneath it. */}
        <nav className="flex flex-col gap-1 text-sm flex-1 mt-4">
          {nav.map((section, si) => (
            <Fragment key={section.title}>
              <span className={`text-xs text-gray-500 uppercase tracking-wider mb-1 ${si === 0 ? 'mt-2' : 'mt-4'}`}>{section.title}</span>
              {section.items.map((item) => (
                <Fragment key={item.href}>
                  <AdminNavLink href={item.href}>
                    {item.icon && <span className="mr-1">{item.icon}</span>}{item.label}
                  </AdminNavLink>
                  {item.children?.map((child) => (
                    <AdminNavLink key={child.href} href={child.href}>
                      {/* No text-color here — let AdminNavLink's active/inactive color win (an active
                          child must render white on the blue pill, not a hardcoded gray). The smaller
                          size + indent + rule already read it as a sub-item. */}
                      <span className="pl-4 text-[13px] border-l border-gray-700 ml-1">{child.label}</span>
                    </AdminNavLink>
                  ))}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </nav>
        <div className="text-xs text-gray-600 mt-4">
          <a href="/portal" className="hover:text-gray-400">Portal &rarr;</a>
        </div>
      </>}
    >
      <AdminNavTrail />
      {children}
    </NavShell>
    </AdminNavProvider>
  );
}
