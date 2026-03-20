import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { sql } from '@/lib/db'

export default async function Home() {
  const session = await auth()
  if (!session?.user) redirect('/login')

  if (session.user.role === 'master_admin') {
    redirect('/admin/dashboard')
  }

  // Tenant user → find their tenant slug
  if (session.user.tenantId) {
    const [tenant] = await sql`
      SELECT slug FROM tenants WHERE id = ${session.user.tenantId} AND status IN ('active', 'trial')
    `
    if (tenant) {
      redirect(`/portal/${tenant.slug}/dashboard`)
    }
  }

  redirect('/login')
}
