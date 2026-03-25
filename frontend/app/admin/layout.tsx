import Link from 'next/link'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AdminNav } from './admin-nav'
import { ConsentGate } from '@/components/consent-gate'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    redirect('/login')
  }

  return (
    <div className="flex h-screen bg-surface-50">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-200/60 bg-white">
        {/* Logo */}
        <div className="flex h-16 items-center border-b border-gray-100 px-5">
          <Link href="/admin/dashboard" className="group flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 shadow-sm transition-all duration-300 group-hover:shadow-glow">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <div>
              <span className="text-sm font-bold text-gray-900">RFP Pipeline</span>
              <span className="block text-[10px] font-medium text-gray-400">Admin Console</span>
            </div>
          </Link>
        </div>

        {/* Nav */}
        <AdminNav />

        {/* User info */}
        <div className="border-t border-gray-100 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">{session.user.name ?? session.user.email}</div>
              <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Master Admin</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">
          {children}
        </div>
      </main>

      {/* Consent gate — blocks UI until legal docs accepted */}
      <ConsentGate isRegistration />
    </div>
  )
}
