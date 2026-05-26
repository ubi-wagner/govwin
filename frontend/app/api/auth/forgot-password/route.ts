import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { sql } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { emitEventSingle, systemActor } from '@/lib/events'

/**
 * POST /api/auth/forgot-password
 *
 * Generates a stateless HMAC-based reset token and emails it.
 * The token encodes the user id and expiry timestamp, signed with
 * HMAC-SHA256 using a secret derived from AUTH_SECRET + the user's
 * current password hash. This means:
 *   - Token is invalid once the password changes (self-invalidating)
 *   - No DB writes needed to create or store the token
 *   - Expires after 1 hour
 *
 * Always returns success to prevent email enumeration.
 */

const TOKEN_TTL_MS = 60 * 60 * 1000 // 1 hour

function getSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET not configured')
  return secret
}

function generateResetToken(userId: string, passwordHash: string, expiresAt: number): string {
  const payload = `${userId}.${expiresAt}`
  const key = `${getSecret()}:${passwordHash}`
  const signature = crypto.createHmac('sha256', key).update(payload).digest('hex')
  // Encode as base64url: userId.expiresAt.signature
  return Buffer.from(`${payload}.${signature}`).toString('base64url')
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    if (!body || !body.email || typeof body.email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required', code: 'MISSING_EMAIL' },
        { status: 400 },
      )
    }

    const normalized = body.email.trim().toLowerCase()

    // Always return success to prevent email enumeration
    try {
      const [user] = await sql<{ id: string; name: string | null; email: string; passwordHash: string | null }[]>`
        SELECT id, name, email, password_hash FROM users
        WHERE email = ${normalized} AND is_active = true
        LIMIT 1
      `

      if (user && user.passwordHash) {
        const expiresAt = Date.now() + TOKEN_TTL_MS
        const token = generateResetToken(user.id, user.passwordHash, expiresAt)

        const baseUrl = process.env.AUTH_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000'
        const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(normalized)}`

        await sendEmail({
          to: normalized,
          subject: 'Reset Your RFP Pipeline Password',
          html: `
            <h2>Password Reset</h2>
            <p>Hi ${user.name || 'there'},</p>
            <p>You requested a password reset. Click the link below to set a new password:</p>
            <p><a href="${resetUrl}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-weight:600;">Reset Password</a></p>
            <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
          `,
        })

        try {
          await emitEventSingle({
            namespace: 'identity',
            type: 'password.reset_requested',
            actor: systemActor('password-reset'),
            tenantId: null,
            payload: { email: normalized },
          })
        } catch (e) {
          console.error('[forgot-password] event emission failed:', e)
        }
      }
    } catch (dbErr) {
      // Log but don't reveal to client
      console.error('[forgot-password] DB/email error:', dbErr)
    }

    // Always return success
    return NextResponse.json({ data: { sent: true } })
  } catch (err) {
    console.error('[forgot-password] error:', err)
    return NextResponse.json(
      { error: 'Internal error', code: 'INTERNAL_ERROR' },
      { status: 500 },
    )
  }
}
