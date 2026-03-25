/**
 * GET /api/admin/compliance — List consent records for audit
 * Query params:
 *   view=consents (default) — legal consents (ToS, privacy, authority)
 *   view=approvals — document approvals (proposals, capability statements)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') ?? 'consents'

  try {
    let records
    if (view === 'approvals') {
      records = await sql`
        SELECT
          cr.id,
          cr.user_id AS "userId",
          u.name AS "userName",
          u.email AS "userEmail",
          cr.tenant_id AS "tenantId",
          t.name AS "tenantName",
          cr.document_type AS "documentType",
          cr.document_version AS "documentVersion",
          cr.action,
          cr.summary,
          cr.entity_type AS "entityType",
          cr.entity_id AS "entityId",
          cr.ip_address AS "ipAddress",
          cr.created_at AS "createdAt"
        FROM consent_records cr
        JOIN users u ON u.id = cr.user_id
        LEFT JOIN tenants t ON t.id = cr.tenant_id
        WHERE cr.document_type = 'document_approval'
        ORDER BY cr.created_at DESC
        LIMIT 500
      `
    } else {
      records = await sql`
        SELECT
          cr.id,
          cr.user_id AS "userId",
          u.name AS "userName",
          u.email AS "userEmail",
          cr.tenant_id AS "tenantId",
          t.name AS "tenantName",
          cr.document_type AS "documentType",
          cr.document_version AS "documentVersion",
          cr.action,
          cr.summary,
          cr.entity_type AS "entityType",
          cr.entity_id AS "entityId",
          cr.ip_address AS "ipAddress",
          cr.created_at AS "createdAt"
        FROM consent_records cr
        JOIN users u ON u.id = cr.user_id
        LEFT JOIN tenants t ON t.id = cr.tenant_id
        WHERE cr.document_type != 'document_approval'
        ORDER BY cr.created_at DESC
        LIMIT 500
      `
    }

    return NextResponse.json({ data: records })
  } catch (error) {
    console.error('[GET /api/admin/compliance] Error:', error)
    return NextResponse.json({ error: 'Failed to load compliance records' }, { status: 500 })
  }
}
