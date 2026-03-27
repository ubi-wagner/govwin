/**
 * POST /api/consent — Record a consent action (accept/decline/revoke)
 * GET  /api/consent — Get current consent status for the authenticated user
 *
 * Consent records are append-only: every acceptance, decline, and revoke
 * is a new row. We also denormalize to users.terms_accepted_at etc. for
 * fast middleware checks.
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

  const {
    documentType,
    documentVersion,
    action = 'accept',
    summary,
    entityType,
    entityId,
  } = body

  if (!documentType || !documentVersion) {
    return NextResponse.json({ error: 'documentType and documentVersion are required' }, { status: 400 })
  }

  const validTypes = [
    'terms_of_service', 'privacy_policy', 'acceptable_use',
    'ai_disclosure', 'authority_representation', 'document_approval',
  ]
  if (!validTypes.includes(documentType)) {
    return NextResponse.json({ error: `Invalid documentType. Must be one of: ${validTypes.join(', ')}` }, { status: 400 })
  }

  const validActions = ['accept', 'decline', 'revoke']
  if (!validActions.includes(action)) {
    return NextResponse.json({ error: 'Invalid action. Must be accept, decline, or revoke' }, { status: 400 })
  }

  const userId = session.user.id
  const tenantId = session.user.tenantId ?? null

  // Extract provenance from request headers
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? null
  const userAgent = request.headers.get('user-agent') ?? null

  try {
    // Insert immutable consent record
    const [record] = await sql`
      INSERT INTO consent_records
        (user_id, tenant_id, document_type, document_version, action, summary, entity_type, entity_id, ip_address, user_agent)
      VALUES
        (${userId}, ${tenantId}, ${documentType}, ${documentVersion}, ${action}, ${summary ?? null}, ${entityType ?? null}, ${entityId ?? null}, ${ip}, ${userAgent})
      RETURNING id, document_type, document_version, action, created_at
    `

    // Denormalize to users table for fast checks
    if (action === 'accept') {
      if (documentType === 'terms_of_service') {
        await sql`
          UPDATE users
          SET terms_accepted_at = NOW(), terms_version = ${documentVersion}, consent_required = FALSE
          WHERE id = ${userId}
        `
      } else if (documentType === 'privacy_policy') {
        await sql`
          UPDATE users SET privacy_accepted_at = NOW() WHERE id = ${userId}
        `
      } else if (documentType === 'authority_representation') {
        await sql`
          UPDATE users SET authority_confirmed_at = NOW() WHERE id = ${userId}
        `
      }
    }

    // Audit log
    try {
      await auditLog({
        userId,
        tenantId: tenantId ?? undefined,
        action: `consent.${action}`,
        entityType: documentType,
        entityId: record.id,
        newValue: { documentType, documentVersion, action, summary, entityType, entityId },
      })
    } catch (e) {
      console.error('[POST /api/consent] Audit log error (non-critical):', e)
    }

    return NextResponse.json({ data: record }, { status: 201 })
  } catch (error: any) {
    console.error('[POST /api/consent] Error:', error)

    // FK violation on user_id means the session references a user that no longer exists
    // (e.g., after a DB rebuild). Tell the client to re-authenticate.
    if (error?.code === '23503' && error?.constraint_name?.includes('user_id')) {
      return NextResponse.json(
        { error: 'Your session is invalid. Please sign out and log in again.', code: 'SESSION_INVALID' },
        { status: 401 }
      )
    }

    return NextResponse.json({ error: 'Failed to record consent' }, { status: 500 })
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const userId = session.user.id

  try {
    // Get the latest consent record per document type for this user
    const consents = await sql`
      SELECT DISTINCT ON (document_type)
        id, document_type, document_version, action, summary, created_at
      FROM consent_records
      WHERE user_id = ${userId}
      ORDER BY document_type, created_at DESC
    `

    // Get current required versions
    const currentVersions = await sql`
      SELECT document_type, version, effective_date
      FROM legal_document_versions
      WHERE is_current = TRUE
    `

    // Build status map: for each doc type, is the user current?
    const status: Record<string, {
      accepted: boolean
      currentVersion: string
      acceptedVersion: string | null
      acceptedAt: string | null
    }> = {}

    for (const cv of currentVersions) {
      const consent = consents.find((c: any) => c.document_type === cv.document_type)
      status[cv.document_type] = {
        accepted: consent?.action === 'accept' && consent?.document_version === cv.version,
        currentVersion: cv.version,
        acceptedVersion: consent?.document_version ?? null,
        acceptedAt: consent?.created_at ?? null,
      }
    }

    // Validate user still exists in DB — if not, force re-auth
    const userCheck = await sql`SELECT id FROM users WHERE id = ${userId}`
    if (userCheck.length === 0) {
      return NextResponse.json(
        { error: 'Session invalid — user not found', code: 'SESSION_INVALID' },
        { status: 401 }
      )
    }

    return NextResponse.json({ data: status })
  } catch (error) {
    console.error('[GET /api/consent] Error:', error)
    return NextResponse.json({ error: 'Failed to load consent status' }, { status: 500 })
  }
}
