import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { sql } from '@/lib/db'

export default async function DashboardRedirect() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (session.user.role === 'master_admin') {
    redirect('/admin/dashboard')
  }

  // Tenant user → find their tenant slug
  if (session.user.tenantId) {
    try {
      const [tenant] = await sql`
        SELECT slug FROM tenants WHERE id = ${session.user.tenantId} AND status IN ('active', 'trial')
      `
      if (tenant) {
        redirect(`/portal/${tenant.slug}/dashboard`)
      }
    } catch (e) {
      // Re-throw redirect (Next.js throws NEXT_REDIRECT internally)
      if (e instanceof Error && e.message === 'NEXT_REDIRECT') throw e
      console.error('[DashboardRedirect] Failed to resolve tenant:', e)
      throw new Error('Unable to load your account. Please try again later.')
    }
  }

  redirect('/login')
}
