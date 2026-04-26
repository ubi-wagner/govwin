export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-navy-900 text-white p-6">
        <h2 className="text-lg font-bold mb-6">Admin</h2>
        <nav className="flex flex-col gap-2 text-sm">
          <a href="/admin/dashboard" className="hover:text-brand-300">Dashboard</a>
          <a href="/admin/rfp-curation" className="hover:text-brand-300">RFP Curation</a>
          <a href="/admin/applications" className="hover:text-brand-300">Applications</a>
          <a href="/admin/tenants" className="hover:text-brand-300">Tenants</a>
          <a href="/admin/pipeline" className="hover:text-brand-300">Pipeline</a>
          <a href="/admin/sources" className="hover:text-brand-300">Sources</a>
          <a href="/admin/agents" className="hover:text-brand-300">Agents</a>
          <a href="/admin/purchases" className="hover:text-brand-300">Purchases</a>
          <a href="/admin/analytics" className="hover:text-brand-300">Analytics</a>
          <a href="/admin/events" className="hover:text-brand-300">Events</a>
          <a href="/admin/storage" className="hover:text-brand-300">Storage</a>
          <a href="/admin/waitlist" className="hover:text-brand-300">Waitlist</a>
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
