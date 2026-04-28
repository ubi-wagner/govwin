export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-navy-900 text-white p-6 flex flex-col">
        <a href="/admin/dashboard" className="text-lg font-bold mb-6 hover:text-brand-300">RFP Admin</a>
        <nav className="flex flex-col gap-1 text-sm flex-1">
          <span className="text-xs text-gray-500 uppercase tracking-wider mt-2 mb-1">Operations</span>
          <a href="/admin/dashboard" className="px-2 py-1.5 rounded hover:bg-navy-800 hover:text-brand-300">Dashboard</a>
          <a href="/admin/applications" className="px-2 py-1.5 rounded hover:bg-navy-800 hover:text-brand-300">Applications</a>
          <a href="/admin/rfp-curation" className="px-2 py-1.5 rounded hover:bg-navy-800 hover:text-brand-300">RFP Curation</a>
          <a href="/admin/tenants" className="px-2 py-1.5 rounded hover:bg-navy-800 hover:text-brand-300">Tenants</a>
          <a href="/admin/billing" className="px-2 py-1.5 rounded hover:bg-navy-800 hover:text-brand-300">Billing</a>

          <span className="text-xs text-gray-500 uppercase tracking-wider mt-4 mb-1">Monitoring</span>
          <a href="/admin/events" className="px-2 py-1.5 rounded hover:bg-navy-800 hover:text-brand-300">Event Stream</a>
          <a href="/admin/pipeline" className="px-2 py-1.5 rounded hover:bg-navy-800 hover:text-brand-300">Pipeline Jobs</a>
          <a href="/admin/system" className="px-2 py-1.5 rounded hover:bg-navy-800 hover:text-brand-300">System Health</a>

          <span className="text-xs text-gray-500 uppercase tracking-wider mt-4 mb-1">Intelligence</span>
          <a href="/admin/sources" className="px-2 py-1.5 rounded hover:bg-navy-800 hover:text-brand-300">Sources</a>

          <span className="text-xs text-gray-500 uppercase tracking-wider mt-4 mb-1">Content</span>
          <a href="/admin/content" className="px-2 py-1.5 rounded hover:bg-navy-800 hover:text-brand-300">CMS Content</a>
          <a href="/admin/storage" className="px-2 py-1.5 rounded hover:bg-navy-800 hover:text-brand-300">S3 Storage</a>
        </nav>
        <div className="text-xs text-gray-600 mt-4">
          <a href="/portal" className="hover:text-gray-400">Portal &rarr;</a>
        </div>
      </aside>
      <main className="flex-1 p-8 bg-gray-50 min-h-screen">{children}</main>
    </div>
  );
}
