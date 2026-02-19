/**
 * POST /api/tenants/[tenantId]/users
 * Admin creates a user for a tenant.
 * Generates a temporary password, marks temp_password=true.
 * User is prompted to set new password on first login.
 *
 * Future: swap temp password for magic link via Resend.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, auditLog } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

type Params = { params: { tenantId: string } }

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { name, email, role = 'tenant_user' } = body

  if (!name || !email) {
    return NextResponse.json({ error: 'name and email required' }, { status: 400 })
  }

  const validRoles = ['tenant_admin', 'tenant_user']
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  // Verify tenant exists
  const [tenant] = await sql`SELECT id, name FROM tenants WHERE id = ${params.tenantId}`
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // Generate temp password
  const tempPassword = crypto.randomBytes(8).toString('base64url')
  const passwordHash = await bcrypt.hash(tempPassword, 12)

  try {
    const [user] = await sql`
      INSERT INTO users (name, email, role, tenant_id, password_hash, temp_password)
      VALUES (${name}, ${email}, ${role}, ${params.tenantId}, ${passwordHash}, true)
      RETURNING id, name, email, role, tenant_id, created_at
    `

    await auditLog({
      userId: session.user.id,
      tenantId: params.tenantId,
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      newValue: { name, email, role, tenantId: params.tenantId },
    })

    // TODO: Send welcome email with temp password via Resend/SMTP
    // For now, return the temp password so admin can share it
    // In production: always send via email, never return in API response

    return NextResponse.json({
      data: user,
      // Remove this in production — only use email delivery
      _tempPassword: tempPassword,
      _note: 'Send this password to the user via secure channel. Remove _tempPassword from production.',
    }, { status: 201 })

  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await sql`
    SELECT id, name, email, role, is_active, last_login_at, temp_password, created_at
    FROM users
    WHERE tenant_id = ${params.tenantId}
    ORDER BY created_at DESC
  `

  return NextResponse.json({ data: users })
}
