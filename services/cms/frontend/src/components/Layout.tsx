import { NavLink, Outlet } from 'react-router-dom'

const navGroups = [
  { label: 'Overview', items: [{ to: '/', label: 'Dashboard' }] },
  {
    label: 'Email',
    items: [
      { to: '/email/accounts', label: 'Accounts' },
      { to: '/email/campaigns', label: 'Campaigns' },
      { to: '/email/outbox', label: 'Outbox (HITL)' },
    ],
  },
  {
    label: 'Content',
    items: [
      { to: '/content', label: 'Pipeline' },
      { to: '/content/generations', label: 'AI Generations' },
      { to: '/content/new', label: 'New Post' },
    ],
  },
  {
    label: 'Social',
    items: [
      { to: '/social/accounts', label: 'Accounts' },
      { to: '/social/posts', label: 'Posts' },
    ],
  },
  { label: 'Drip', items: [{ to: '/drip', label: 'Campaigns' }] },
  { label: 'Tasks', items: [{ to: '/todos', label: 'TODOs' }] },
]

export default function Layout() {
  return (
    <div className="min-h-screen flex">
      <aside className="w-60 bg-slate-900 text-white p-5 flex flex-col shrink-0">
        <a href="/cms/" className="text-lg font-bold mb-6 text-blue-400 hover:text-blue-300">
          CRM Console
        </a>
        <nav className="flex flex-col gap-1 text-sm flex-1">
          {navGroups.map((g) => (
            <div key={g.label}>
              <span className="text-xs text-gray-500 uppercase tracking-wider mt-3 mb-1 block">
                {g.label}
              </span>
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    `block px-2 py-1.5 rounded ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-300 hover:bg-slate-800 hover:text-white'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="text-xs text-gray-600 mt-4">CMS/CRM Service</div>
      </aside>
      <main className="flex-1 p-8 bg-gray-50 min-h-screen overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
