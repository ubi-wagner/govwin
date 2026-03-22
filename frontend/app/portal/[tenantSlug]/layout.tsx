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
  params: Promise<{ tenantSlug: string }>
}) {
  const { tenantSlug } = await params

  const session = await auth()
  if (!session?.user) redirect('/login')

  let tenant: Record<string, any> | undefined
  try {
    // Resolve tenant from slug
    const [row] = await sql`
      SELECT id, slug, name, status FROM tenants
      WHERE slug = ${tenantSlug} AND status IN ('active', 'trial')
    `
    tenant = row
  } catch (e) {
    console.error('[PortalLayout] Failed to resolve tenant:', e)
    throw new Error('Unable to load tenant. Please try again later.')
  }

  if (!tenant) redirect('/')

  // Verify access: master admin can view any, tenant users must match
  if (session.user.role !== 'master_admin') {
    try {
      const [access] = await sql`
        SELECT id FROM users
        WHERE id = ${session.user.id!} AND tenant_id = ${tenant.id} AND is_active = true
      `
      if (!access) redirect('/')
    } catch (e) {
      console.error('[PortalLayout] Failed to verify tenant access:', e)
      throw new Error('Unable to verify access. Please try again later.')
    }
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-200 bg-white">
        <div className="flex h-14 items-center border-b border-gray-200 px-4">
          <Link href={`/portal/${tenantSlug}/dashboard`} className="flex items-center gap-2 text-lg font-bold text-brand-700 truncate">
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-brand-600">
              <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <span className="truncate">{tenant.name}</span>
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
