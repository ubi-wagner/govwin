/**
 * GET /api/portal/[tenantSlug]/documents
 * Portal-accessible download links endpoint.
 * Returns active download_links for the tenant.
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

  const hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
}
