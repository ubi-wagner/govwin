import Link from 'next/link'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { sql } from '@/lib/db'
import { PortalNav } from './portal-nav'

export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenantSlug: string }> | { tenantSlug: string }
}) {
  // Next.js 15+: params is a Promise; Next.js 13-14: params is an object
  const resolvedParams = await Promise.resolve(params)
  const tenantSlug = resolvedParams.tenantSlug

  const session = await auth()
  if (!session?.user) redirect('/login')

  // Resolve tenant from slug
  const [tenant] = await sql`
    SELECT id, slug, name, status FROM tenants
    WHERE slug = ${tenantSlug} AND status = 'active'
  `

  if (!tenant) redirect('/')

  // Verify access: master admin can view any, tenant users must match
  if (session.user.role !== 'master_admin') {
    const [access] = await sql`
      SELECT id FROM users
      WHERE id = ${session.user.id!} AND tenant_id = ${tenant.id} AND is_active = true
    `
    if (!access) redirect('/')
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-14 items-center border-b border-gray-200 px-4">
          <Link href={`/portal/${tenantSlug}/dashboard`} className="text-lg font-bold text-brand-700 truncate">
            {tenant.name}
          </Link>
        </div>

        <PortalNav tenantSlug={tenantSlug} />

        <div className="border-t border-gray-200 p-4">
          <div className="text-sm font-medium text-gray-900 truncate">
            {session.user.name ?? session.user.email}
          </div>
          <div className="text-xs text-gray-500 capitalize">{session.user.role.replace('_', ' ')}</div>
          {session.user.role === 'master_admin' && (
            <Link href="/admin/dashboard" className="mt-2 block text-xs text-brand-600 hover:text-brand-800">
              &larr; Back to Admin
            </Link>
          )}
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
