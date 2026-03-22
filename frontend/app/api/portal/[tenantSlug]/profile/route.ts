/**
 * GET /api/portal/[tenantSlug]/profile
 * Portal-accessible tenant profile endpoint.
 * Accessible to tenant_user, tenant_admin, and master_admin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'

type Params = { params: Promise<{ tenantSlug: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[GET /api/portal/profile] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[GET /api/portal/profile] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const [profile] = await sql`
      SELECT * FROM tenant_profiles WHERE tenant_id = ${tenant.id}
    `

    return NextResponse.json({
      tenant: {
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
      },
      profile: profile ?? null,
    })
  } catch (error) {
    console.error('[GET /api/portal/profile] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
