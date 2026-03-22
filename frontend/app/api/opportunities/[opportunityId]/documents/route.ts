/**
 * GET /api/opportunities/[opportunityId]/documents?tenantSlug=xxx
 * Returns document download status for this opportunity.
 *
 * Documents are stored per-opportunity (shared across tenants).
 * Any tenant with access to the opportunity can view document status.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import type { AppSession } from '@/types'

type Params = { params: Promise<{ opportunityId: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const session = (await auth()) as AppSession | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { opportunityId } = await params
  const { searchParams } = new URL(request.url)
  const tenantSlug = searchParams.get('tenantSlug')

  if (!tenantSlug) {
    return NextResponse.json({ error: 'tenantSlug required' }, { status: 400 })
  }

  let tenant: Record<string, unknown> | null
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[GET /api/opportunities/documents] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id as string)
  } catch (error) {
    console.error('[GET /api/opportunities/documents] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Verify the opportunity exists and is in this tenant's pipeline
  try {
    const [oppExists] = await sql`
      SELECT 1 FROM tenant_opportunities
      WHERE tenant_id = ${tenant.id as string}
        AND opportunity_id = ${opportunityId}
    `
    if (!oppExists) {
      return NextResponse.json({ error: 'Opportunity not found for this tenant' }, { status: 404 })
    }
  } catch (error) {
    console.error('[GET /api/opportunities/documents] Tenant-opp check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  try {
    const documents = await sql`
      SELECT
        id,
        filename,
        original_url,
        storage_path,
        file_hash,
        file_size_bytes,
        mime_type,
        document_type,
        is_primary,
        download_status,
        download_error,
        downloaded_at,
        created_at
      FROM documents
      WHERE opportunity_id = ${opportunityId}
      ORDER BY is_primary DESC, created_at ASC
    `

    // Summary counts for quick UI rendering
    const total = documents.length
    const downloaded = documents.filter((d: Record<string, unknown>) => d.downloadStatus === 'downloaded').length
    const pending = documents.filter((d: Record<string, unknown>) => d.downloadStatus === 'pending' || d.downloadStatus === 'downloading').length
    const errored = documents.filter((d: Record<string, unknown>) => d.downloadStatus === 'error').length

    return NextResponse.json({
      data: documents,
      summary: { total, downloaded, pending, errored },
    })
  } catch (error) {
    console.error('[GET /api/opportunities/documents] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
