import { AdminNavLink } from '@/components/admin/admin-nav-link';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-navy-900 text-white p-6 flex flex-col">
        <AdminNavLink href="/admin/dashboard">
          <span className="text-lg font-bold">RFP Admin</span>
        </AdminNavLink>

        <nav className="flex flex-col gap-1 text-sm flex-1 mt-4">
          <span className="text-xs text-gray-500 uppercase tracking-wider mt-2 mb-1">Overview</span>
          <AdminNavLink href="/admin/dashboard">Dashboard</AdminNavLink>

          <span className="text-xs text-gray-500 uppercase tracking-wider mt-4 mb-1">Opportunities</span>
          <AdminNavLink href="/admin/rfp-curation">RFP Curation</AdminNavLink>
          <AdminNavLink href="/admin/sources">Sources</AdminNavLink>
          <AdminNavLink href="/admin/pipeline">Pipeline Jobs</AdminNavLink>
          <AdminNavLink href="/admin/templates">Templates</AdminNavLink>

          <span className="text-xs text-gray-500 uppercase tracking-wider mt-4 mb-1">Customers</span>
          <AdminNavLink href="/admin/applications">Applications</AdminNavLink>
          <AdminNavLink href="/admin/tenants">Tenants</AdminNavLink>
          <AdminNavLink href="/admin/billing">Billing</AdminNavLink>
          <AdminNavLink href="/admin/waitlist">Waitlist</AdminNavLink>
          <AdminNavLink href="/admin/purchases">Purchases</AdminNavLink>
          <AdminNavLink href="/admin/proposals">Proposals</AdminNavLink>

          <span className="text-xs text-gray-500 uppercase tracking-wider mt-4 mb-1">Content</span>
          <AdminNavLink href="/admin/content/editor">Visual Editor</AdminNavLink>
          <AdminNavLink href={process.env.CMS_PUBLIC_URL || process.env.CMS_SERVICE_URL || '/cms'} external>CMS Portal</AdminNavLink>
          <AdminNavLink href="/admin/documents">Document Builder</AdminNavLink>
          <AdminNavLink href="/admin/storage">S3 Storage</AdminNavLink>

          <span className="text-xs text-gray-500 uppercase tracking-wider mt-4 mb-1">System</span>
          <AdminNavLink href="/admin/system-state">System State</AdminNavLink>
          <AdminNavLink href="/admin/events">Event Stream</AdminNavLink>
          <AdminNavLink href="/admin/agents">Agents</AdminNavLink>
          <AdminNavLink href="/admin/process">Process Monitor</AdminNavLink>
          <AdminNavLink href="/admin/workflows">Workflows</AdminNavLink>
          <AdminNavLink href="/admin/system">System Health</AdminNavLink>
          <AdminNavLink href="/admin/analytics">Analytics</AdminNavLink>

          <span className="text-xs text-gray-500 uppercase tracking-wider mt-4 mb-1">CRM</span>
          <a
            href={process.env.CMS_PUBLIC_URL || 'https://rfp-crm-production.up.railway.app/cms/'}
            target="_blank"
            rel="noopener noreferrer"
            className="block px-3 py-1.5 rounded text-sm text-slate-300 hover:text-white hover:bg-slate-700"
          >
            CRM Console &nearr;
          </a>
        </nav>
        <div className="text-xs text-gray-600 mt-4">
          <a href="/portal" className="hover:text-gray-400">Portal &rarr;</a>
        </div>
      </aside>
      <main className="flex-1 p-8 bg-gray-50 min-h-screen">{children}</main>
    </div>
  );
}
