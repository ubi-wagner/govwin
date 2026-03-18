/**
 * GET /api/portal/[tenantSlug]/profile
 * Portal-accessible tenant profile endpoint.
 * Accessible to tenant_user, tenant_admin, and master_admin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'

type Params = { params: { tenantSlug: string } }

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenant = await getTenantBySlug(params.tenantSlug)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  const hasAccess = await verifyTenantAccess(session.user.id!, session.user.role, tenant.id)
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
}
