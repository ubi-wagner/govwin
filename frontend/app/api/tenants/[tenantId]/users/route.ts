/**
 * POST /api/tenants/[tenantId]/users
 * Admin creates a user for a tenant.
 * Generates a temporary password, marks temp_password=true.
 * User is prompted to set new password on first login.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, auditLog } from '@/lib/db'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

type Params = { params: Promise<{ tenantId: string }> }

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { tenantId } = await params

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const { name, email, role = 'tenant_user' } = body

  if (!name || !email) {
    return NextResponse.json({ error: 'name and email required' }, { status: 400 })
  }

  const validRoles = ['tenant_admin', 'tenant_user']
  if (!validRoles.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  try {
  // Verify tenant exists
  const [tenant] = await sql`SELECT id, name FROM tenants WHERE id = ${tenantId}`
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // Generate temp password
  const tempPassword = crypto.randomBytes(8).toString('base64url')
  const passwordHash = await bcrypt.hash(tempPassword, 12)
    const [user] = await sql`
      INSERT INTO users (name, email, role, tenant_id, password_hash, temp_password)
      VALUES (${name}, ${email}, ${role}, ${tenantId}, ${passwordHash}, true)
      RETURNING id, name, email, role, tenant_id, created_at
    `

    await auditLog({
      userId: session.user.id,
      tenantId,
      action: 'user.created',
      entityType: 'user',
      entityId: user.id,
      newValue: { name, email, role, tenantId },
    })

    // V1: return temp password for admin to share via secure channel.
    // Phase 2: send welcome email via Resend/SMTP instead.
    return NextResponse.json({
      data: user,
      _tempPassword: tempPassword,
    }, { status: 201 })

  } catch (error: any) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
    }
    console.error('[POST /api/tenants/[tenantId]/users] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { tenantId } = await params

  try {
    const users = await sql`
      SELECT id, name, email, role, is_active, last_login_at, temp_password, created_at
      FROM users
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
    `

    return NextResponse.json({ data: users })
  } catch (error) {
    console.error('[GET /api/tenants/[id]/users] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
