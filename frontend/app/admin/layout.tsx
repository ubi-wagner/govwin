import { Fragment } from 'react';
import { AdminNavLink } from '@/components/admin/admin-nav-link';
import { AdminNavProvider } from '@/components/admin/admin-nav-context';
import { AdminNavTrail } from '@/components/admin/admin-nav-trail';
import { ADMIN_NAV } from '@/components/admin/admin-nav-data';
import { NavShell } from '@/components/ui/nav-shell';

export const metadata = { title: 'Admin' };

export default function AdminLayout({ children }: { children: React.ReactNode }) {
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
          {ADMIN_NAV.map((section, si) => (
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
