import { NextResponse } from 'next/server'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { sql } from '@/lib/db'
import { emitEventSingle, systemActor } from '@/lib/events'

/**
 * POST /api/auth/reset-password
 *
 * Validates the HMAC-based reset token, then updates the password.
 * The token is self-invalidating: once the password changes, the
 * old token's HMAC no longer verifies because it was signed with
 * the previous password hash.
 */

function getSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET not configured')
  return secret
}

function verifyResetToken(
  token: string,
  passwordHash: string,
): { valid: true; userId: string } | { valid: false; reason: string } {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf-8')
    const parts = decoded.split('.')
    if (parts.length !== 3) {
      return { valid: false, reason: 'malformed token' }
    }

    const [userId, expiresAtStr, signature] = parts
    const expiresAt = parseInt(expiresAtStr, 10)

    if (isNaN(expiresAt) || Date.now() > expiresAt) {
      return { valid: false, reason: 'token expired' }
    }

    const payload = `${userId}.${expiresAtStr}`
    const key = `${getSecret()}:${passwordHash}`
    const expectedSig = crypto.createHmac('sha256', key).update(payload).digest('hex')

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return { valid: false, reason: 'invalid signature' }
    }

    return { valid: true, userId }
  } catch {
    return { valid: false, reason: 'token decode failed' }
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body) {
      return NextResponse.json(
        { error: 'Request body required', code: 'INVALID_BODY' },
        { status: 400 },
      )
    }

    const { token, email, password } = body

    if (!token || typeof token !== 'string') {
      return NextResponse.json(
        { error: 'Reset token is required', code: 'MISSING_TOKEN' },
        { status: 400 },
      )
    }
    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required', code: 'MISSING_EMAIL' },
        { status: 400 },
      )
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters', code: 'WEAK_PASSWORD' },
        { status: 400 },
      )
    }

    const normalized = email.trim().toLowerCase()

    // Look up the user
    let user: { id: string; passwordHash: string | null } | undefined
    try {
      const [row] = await sql<{ id: string; passwordHash: string | null }[]>`
        SELECT id, password_hash FROM users
        WHERE email = ${normalized} AND is_active = true
        LIMIT 1
      `
      user = row
    } catch (dbErr) {
      console.error('[reset-password] DB lookup error:', dbErr)
      return NextResponse.json(
        { error: 'Internal error', code: 'INTERNAL_ERROR' },
        { status: 500 },
      )
    }

    if (!user || !user.passwordHash) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link', code: 'INVALID_TOKEN' },
        { status: 400 },
      )
    }

    // Verify the token against the current password hash
    const result = verifyResetToken(token, user.passwordHash)
    if (!result.valid) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link', code: 'INVALID_TOKEN' },
        { status: 400 },
      )
    }

    // Ensure the token's userId matches the looked-up user
    if (result.userId !== user.id) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link', code: 'INVALID_TOKEN' },
        { status: 400 },
      )
    }

    // Hash the new password and update
    const newHash = await bcrypt.hash(password, 12)
    try {
      await sql`
        UPDATE users
        SET password_hash = ${newHash},
            temp_password = false,
            updated_at = now()
        WHERE id = ${user.id}
      `
    } catch (dbErr) {
      console.error('[reset-password] DB update error:', dbErr)
      return NextResponse.json(
        { error: 'Internal error', code: 'INTERNAL_ERROR' },
        { status: 500 },
      )
    }

    try {
      await emitEventSingle({
        namespace: 'identity',
        type: 'password.reset_completed',
        actor: systemActor('password-reset'),
        tenantId: null,
        payload: { email: normalized },
      })
    } catch (e) {
      console.error('[reset-password] event emission failed:', e)
    }

    return NextResponse.json({ data: { reset: true } })
  } catch (err) {
    console.error('[reset-password] error:', err)
    return NextResponse.json(
      { error: 'Internal error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
