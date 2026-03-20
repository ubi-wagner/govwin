/**
 * GET /api/portal/[tenantSlug]/documents
 * Portal-accessible download links endpoint.
 * Returns active download_links for the tenant.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'

type Params = { params: Promise<{ tenantSlug: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[GET /api/portal/documents] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id!, session.user.role, tenant.id)
  } catch (error) {
    console.error('[GET /api/portal/documents] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const links = await sql`
      SELECT id, title, description, url, link_type, opportunity_id,
             access_count, created_at
      FROM download_links
      WHERE tenant_id = ${tenant.id}
        AND is_active = true
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
    `

    return NextResponse.json({ data: links })
  } catch (error) {
    console.error('[GET /api/portal/documents] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
