import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, auditLog } from '@/lib/db'
import { encryptApiKey, keyHint } from '@/lib/crypto'

const VALID_SOURCES = ['sam_gov', 'anthropic']

/**
 * GET /api/admin/api-keys/[source]
 * Returns key metadata (hint, expiry, status) — never the actual key.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'master_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { source } = await params
    if (!VALID_SOURCES.includes(source)) {
      return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
    }

    const [row] = await sql`
      SELECT source, key_hint, issued_date, expires_date, is_valid,
             rotated_at, issued_by,
             CASE WHEN expires_date IS NULL THEN NULL
                  ELSE (expires_date - CURRENT_DATE)::INT END AS days_until_expiry,
             CASE WHEN expires_date IS NULL THEN 'no_expiry'
                  WHEN (expires_date - CURRENT_DATE) < 0 THEN 'expired'
                  WHEN (expires_date - CURRENT_DATE) < days_warning THEN 'expiring_soon'
                  ELSE 'ok' END AS expiry_status,
             encrypted_value IS NOT NULL AS has_stored_key
      FROM api_key_registry
      WHERE source = ${source}
    `

    if (!row) return NextResponse.json({ error: 'Source not found' }, { status: 404 })

    return NextResponse.json({ data: row })
  } catch (error) {
    console.error('[GET /api/admin/api-keys] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch API key info' }, { status: 500 })
  }
}

/**
 * POST /api/admin/api-keys/[source]
 * Rotate an API key: encrypts and stores in api_key_registry.
 *
 * Body: { apiKey: string, expiresDate?: string }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  try {
    const session = await auth()
    if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'master_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { source } = await params
    if (!VALID_SOURCES.includes(source)) {
      return NextResponse.json({ error: 'Invalid source' }, { status: 400 })
    }

    let body: { apiKey?: string; expiresDate?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const { apiKey, expiresDate } = body
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 8) {
      return NextResponse.json({ error: 'API key must be at least 8 characters' }, { status: 400 })
    }

    const trimmed = apiKey.trim()
    const encrypted = encryptApiKey(trimmed)
    const hint = keyHint(trimmed)

    // Default SAM.gov keys to 90 days from now if no date provided
    const expires = expiresDate
      ? expiresDate
      : source === 'sam_gov'
        ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        : null

    await sql`
      UPDATE api_key_registry
      SET encrypted_value = ${encrypted},
          key_hint = ${hint},
          issued_date = CURRENT_DATE,
          expires_date = ${expires},
          is_valid = true,
          rotated_at = NOW(),
          issued_by = ${session.user.email ?? session.user.id},
          updated_at = NOW()
      WHERE source = ${source}
    `

    await auditLog({
      userId: session.user.id,
      action: 'api_key_rotated',
      entityType: 'api_key',
      entityId: source,
      newValue: { keyHint: hint, expiresDate: expires },
    })

    return NextResponse.json({
      data: { source, keyHint: hint, expiresDate: expires, rotatedAt: new Date().toISOString() },
    })
  } catch (error) {
    console.error('[POST /api/admin/api-keys] Error:', error)
    return NextResponse.json({ error: 'Failed to rotate API key' }, { status: 500 })
  }
}
