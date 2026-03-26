import Link from 'next/link'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { sql } from '@/lib/db'
import { PortalNav } from './portal-nav'
import { ConsentGate } from '@/components/consent-gate'
import { SignOutButton } from '@/components/sign-out-button'

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
        WHERE id = ${session.user.id ?? ''} AND tenant_id = ${tenant.id} AND is_active = true
      `
      if (!access) redirect('/')
    } catch (e) {
      console.error('[PortalLayout] Failed to verify tenant access:', e)
      throw new Error('Unable to verify access. Please try again later.')
    }
  }

  return (
    <div className="flex h-screen bg-surface-50">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-gray-200/60 bg-white">
        {/* Tenant header */}
        <div className="flex h-16 items-center border-b border-gray-100 px-5">
          <Link href={`/portal/${tenantSlug}/dashboard`} className="group flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-600 to-brand-700 shadow-sm transition-all duration-300 group-hover:shadow-glow">
              <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <div className="min-w-0">
              <span className="block text-sm font-bold text-gray-900 truncate">{tenant.name}</span>
              <span className="block text-[10px] font-medium text-gray-400">RFP Pipeline</span>
            </div>
          </Link>
        </div>

        {/* Nav */}
        <PortalNav tenantSlug={tenantSlug} />

        {/* User info */}
        <div className="border-t border-gray-100 p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 truncate">
                {session.user.name ?? session.user.email}
              </div>
              <div className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">
                {session.user.role.replace('_', ' ')}
              </div>
            </div>
          </div>
          {session.user.role === 'master_admin' && (
            <Link href="/admin/dashboard" className="mt-3 flex items-center gap-1.5 text-xs font-medium text-brand-600 hover:text-brand-800 transition-colors">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
              </svg>
              Back to Admin
            </Link>
          )}
          <div className="mt-3">
            <SignOutButton />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl px-6 py-8">
          {children}
        </div>
      </main>

      {/* Consent gate — tenant users accept terms but not authority representation */}
      <ConsentGate />
    </div>
  )
}
