/**
 * POST /api/consent/approvals — Record approval of a document/proposal
 * GET  /api/consent/approvals — List approval history for a tenant
 *
 * This endpoint records when a user reviews and approves a platform-generated
 * or uploaded document (proposal, capability statement, past performance, etc.).
 * Each approval is an immutable consent record with entity reference, making it
 * fully auditable.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, auditLog } from '@/lib/db'

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { entityType, entityId, summary } = body

  if (!entityType || !entityId) {
    return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 })
  }

  const validEntityTypes = [
    'proposal', 'capability_statement', 'past_performance',
    'personnel_resume', 'compliance_matrix', 'draft', 'document',
  ]
  if (!validEntityTypes.includes(entityType)) {
    return NextResponse.json(
      { error: `Invalid entityType. Must be one of: ${validEntityTypes.join(', ')}` },
      { status: 400 }
    )
  }

  const userId = session.user.id
  const tenantId = session.user.tenantId ?? null
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? null
  const userAgent = request.headers.get('user-agent') ?? null

  try {
    const [record] = await sql`
      INSERT INTO consent_records
        (user_id, tenant_id, document_type, document_version, action, summary, entity_type, entity_id, ip_address, user_agent)
      VALUES
        (${userId}, ${tenantId}, 'document_approval', 'n/a', 'accept',
         ${summary ?? `Approved ${entityType} ${entityId.slice(0, 8)}`},
         ${entityType}, ${entityId}, ${ip}, ${userAgent})
      RETURNING id, document_type, action, entity_type, entity_id, summary, created_at
    `

    try {
      await auditLog({
        userId,
        tenantId: tenantId ?? undefined,
        action: 'document.approved',
        entityType,
        entityId,
        newValue: { entityType, entityId, summary, approvedBy: userId },
      })
    } catch (e) {
      console.error('[POST /api/consent/approvals] Audit log error (non-critical):', e)
    }

    return NextResponse.json({ data: record }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/consent/approvals] Error:', error)
    return NextResponse.json({ error: 'Failed to record approval' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tenantId = session.user.tenantId
  const { searchParams } = new URL(request.url)
  const entityType = searchParams.get('entityType')
  const entityId = searchParams.get('entityId')

  try {
    let approvals
    if (entityId) {
      // Get approvals for a specific entity
      approvals = await sql`
        SELECT cr.id, cr.user_id, u.name AS user_name, u.email AS user_email,
               cr.entity_type, cr.entity_id, cr.summary,
               cr.ip_address, cr.created_at
        FROM consent_records cr
        JOIN users u ON u.id = cr.user_id
        WHERE cr.document_type = 'document_approval'
          AND cr.entity_id = ${entityId}
          AND cr.action = 'accept'
        ORDER BY cr.created_at DESC
      `
    } else if (tenantId) {
      // Get recent approvals for this tenant
      approvals = await sql`
        SELECT cr.id, cr.user_id, u.name AS user_name, u.email AS user_email,
               cr.entity_type, cr.entity_id, cr.summary,
               cr.ip_address, cr.created_at
        FROM consent_records cr
        JOIN users u ON u.id = cr.user_id
        WHERE cr.document_type = 'document_approval'
          AND cr.tenant_id = ${tenantId}
          AND cr.action = 'accept'
          ${entityType ? sql`AND cr.entity_type = ${entityType}` : sql``}
        ORDER BY cr.created_at DESC
        LIMIT 100
      `
    } else if (session.user.role === 'master_admin') {
      // Master admin: all recent approvals
      approvals = await sql`
        SELECT cr.id, cr.user_id, u.name AS user_name, u.email AS user_email,
               cr.tenant_id, cr.entity_type, cr.entity_id, cr.summary,
               cr.ip_address, cr.created_at
        FROM consent_records cr
        JOIN users u ON u.id = cr.user_id
        WHERE cr.document_type = 'document_approval'
          AND cr.action = 'accept'
        ORDER BY cr.created_at DESC
        LIMIT 100
      `
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    return NextResponse.json({ data: approvals })
  } catch (error) {
    console.error('[GET /api/consent/approvals] Error:', error)
    return NextResponse.json({ error: 'Failed to load approvals' }, { status: 500 })
  }
}
