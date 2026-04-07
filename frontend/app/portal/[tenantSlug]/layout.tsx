export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-gray-50 border-r p-6">
        <h2 className="text-lg font-bold mb-6">Portal</h2>
        <nav className="flex flex-col gap-2 text-sm">
          <a href="dashboard">Dashboard</a>
          <a href="pipeline">Pipeline</a>
          <a href="spotlights">Spotlights</a>
          <a href="proposals">Proposals</a>
          <a href="library">Library</a>
          <a href="documents">Documents</a>
          <a href="team">Team</a>
          <a href="profile">Profile</a>
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
