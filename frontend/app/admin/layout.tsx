import Link from 'next/link'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AdminNav } from './admin-nav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    redirect('/login')
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-14 items-center border-b border-gray-200 px-4">
          <Link href="/admin/dashboard" className="text-lg font-bold text-brand-700">
            RFP Pipeline
          </Link>
        </div>

        <AdminNav />

        <div className="border-t border-gray-200 p-4">
          <div className="text-sm font-medium text-gray-900 truncate">{session.user.name ?? session.user.email}</div>
          <div className="text-xs text-gray-500">Master Admin</div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-gray-50">
        <div className="mx-auto max-w-7xl px-6 py-6">
          {children}
        </div>
      </main>
    </div>
  )
}
