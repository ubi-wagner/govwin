import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, auditLog } from '@/lib/db'
import { encryptApiKey, keyHint, decryptApiKey } from '@/lib/crypto'

const VALID_SOURCES = ['sam_gov', 'anthropic']

// SAM.gov test URL — a lightweight search that validates the key works
const SAM_TEST_URL = 'https://api.sam.gov/opportunities/v2/search?limit=1&postedFrom=01/01/2025&postedTo=01/02/2025'

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
                  WHEN (expires_date - CURRENT_DATE) < 14 THEN 'expiring_soon'
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
    let encrypted: string
    let hint: string
    try {
      encrypted = encryptApiKey(trimmed)
      hint = keyHint(trimmed)
    } catch (err) {
      console.error('[POST /api/admin/api-keys] Encryption error:', err)
      return NextResponse.json({ error: 'Failed to encrypt API key' }, { status: 500 })
    }

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

/**
 * PATCH /api/admin/api-keys/[source]
 * Test API key connectivity — makes a lightweight request to the external service
 * and records the result. This is the only way to know if a key actually works.
 *
 * Body: { action: 'validate' }
 */
export async function PATCH(
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

    let body: { action?: string }
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    if (body.action !== 'validate') {
      return NextResponse.json({ error: 'Only action "validate" is supported' }, { status: 400 })
    }

    // Retrieve the encrypted key
    const [row] = await sql`
      SELECT encrypted_value FROM api_key_registry WHERE source = ${source}
    `
    if (!row?.encryptedValue) {
      const msg = 'No encrypted key stored — cannot test connectivity'
      await sql`
        UPDATE api_key_registry
        SET last_validated_at = NOW(), last_validation_ok = false, last_validation_msg = ${msg}
        WHERE source = ${source}
      `
      return NextResponse.json({ data: { ok: false, message: msg } })
    }

    let plainKey: string
    try {
      plainKey = decryptApiKey(row.encryptedValue)
    } catch (err) {
      const msg = 'Decryption failed — check API_KEY_ENCRYPTION_SECRET parity'
      console.error('[PATCH /api/admin/api-keys] Decryption error:', err)
      await sql`
        UPDATE api_key_registry
        SET last_validated_at = NOW(), last_validation_ok = false, last_validation_msg = ${msg}
        WHERE source = ${source}
      `
      return NextResponse.json({ data: { ok: false, message: msg } })
    }

    // Test connectivity based on source type
    let ok = false
    let message = ''

    if (source === 'sam_gov') {
      try {
        const res = await fetch(`${SAM_TEST_URL}&api_key=${encodeURIComponent(plainKey)}`, {
          signal: AbortSignal.timeout(15000),
        })
        if (res.ok) {
          ok = true
          message = `SAM.gov responded OK (HTTP ${res.status})`
        } else if (res.status === 403 || res.status === 401) {
          message = `SAM.gov rejected the key (HTTP ${res.status}) — key may be expired or revoked`
        } else {
          message = `SAM.gov returned HTTP ${res.status} — service may be temporarily unavailable`
        }
      } catch (err) {
        message = `Could not reach SAM.gov: ${err instanceof Error ? err.message : 'network error'}`
      }
    } else if (source === 'anthropic') {
      // Test with a minimal message count request
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages/count_tokens', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': plainKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            messages: [{ role: 'user', content: 'test' }],
          }),
          signal: AbortSignal.timeout(15000),
        })
        if (res.ok) {
          ok = true
          message = `Anthropic API responded OK (HTTP ${res.status})`
        } else if (res.status === 401) {
          message = 'Anthropic rejected the API key — key is invalid or revoked'
        } else if (res.status === 403) {
          message = 'Anthropic key lacks permissions — check API key scope'
        } else {
          // 400 from count_tokens is still a valid auth check — key is accepted
          if (res.status === 400) {
            ok = true
            message = 'Anthropic API key is valid (auth check passed)'
          } else {
            message = `Anthropic returned HTTP ${res.status}`
          }
        }
      } catch (err) {
        message = `Could not reach Anthropic API: ${err instanceof Error ? err.message : 'network error'}`
      }
    }

    // Record the result
    await sql`
      UPDATE api_key_registry
      SET last_validated_at = NOW(), last_validation_ok = ${ok}, last_validation_msg = ${message}
      WHERE source = ${source}
    `

    return NextResponse.json({ data: { ok, message } })
  } catch (error) {
    console.error('[PATCH /api/admin/api-keys] Error:', error)
    return NextResponse.json({ error: 'Failed to validate API key' }, { status: 500 })
  }
}
