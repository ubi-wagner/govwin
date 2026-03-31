/**
 * GET  /api/invite?token=xxx — Validate invite token, return pre-filled info
 * POST /api/invite          — Accept invite (create user account with password)
 *
 * Public routes — no auth required (invitee doesn't have an account yet).
 */
import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { sql } from '@/lib/db'
import { emitCustomerEvent } from '@/lib/events'

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Token is required' }, { status: 400 })

  try {
    const [invitation] = await sql`
      SELECT
        ti.id, ti.tenant_id, ti.email, ti.name, ti.role,
        ti.company, ti.phone, ti.notes, ti.status, ti.expires_at,
        t.name AS tenant_name, t.slug AS tenant_slug
      FROM team_invitations ti
      JOIN tenants t ON ti.tenant_id = t.id
      WHERE ti.token = ${token}
    `

    if (!invitation) {
      return NextResponse.json({ error: 'Invalid invitation link' }, { status: 404 })
    }

    if (invitation.status !== 'pending') {
      return NextResponse.json({
        error: invitation.status === 'accepted'
          ? 'This invitation has already been accepted'
          : 'This invitation has been ' + invitation.status,
      }, { status: 410 })
    }

    if (new Date(invitation.expires_at) < new Date()) {
      // Mark as expired
      await sql`UPDATE team_invitations SET status = 'expired' WHERE id = ${invitation.id}`
      return NextResponse.json({ error: 'This invitation has expired. Ask your admin to resend.' }, { status: 410 })
    }

    return NextResponse.json({
      data: {
        email: invitation.email,
        name: invitation.name,
        role: invitation.role,
        company: invitation.company,
        phone: invitation.phone,
        notes: invitation.notes,
        tenantName: invitation.tenant_name,
        tenantSlug: invitation.tenant_slug,
      },
    })
  } catch (error) {
    console.error('[GET /api/invite] Error:', error)
    return NextResponse.json({ error: 'Failed to validate invitation' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { token, password } = body

  if (!token || !password) {
    return NextResponse.json({ error: 'Token and password are required' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  try {
    // Validate token
    const [invitation] = await sql`
      SELECT
        ti.id, ti.tenant_id, ti.email, ti.name, ti.role,
        ti.company, ti.phone, ti.notes, ti.status, ti.expires_at,
        t.slug AS tenant_slug
      FROM team_invitations ti
      JOIN tenants t ON ti.tenant_id = t.id
      WHERE ti.token = ${token}
      FOR UPDATE
    `

    if (!invitation) {
      return NextResponse.json({ error: 'Invalid invitation' }, { status: 404 })
    }

    if (invitation.status !== 'pending') {
      return NextResponse.json({ error: 'This invitation is no longer valid' }, { status: 410 })
    }

    if (new Date(invitation.expires_at) < new Date()) {
      await sql`UPDATE team_invitations SET status = 'expired' WHERE id = ${invitation.id}`
      return NextResponse.json({ error: 'This invitation has expired' }, { status: 410 })
    }

    // Check email not already taken
    const existingUser = await sql`SELECT id FROM users WHERE email = ${invitation.email}`
    if (existingUser.length > 0) {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }

    // Create user
    const userId = `user-${invitation.tenant_id.slice(0, 8)}-${Date.now()}`
    const passwordHash = await bcrypt.hash(password, 12)

    const [user] = await sql`
      INSERT INTO users (
        id, name, email, role, tenant_id,
        password_hash, temp_password, is_active,
        phone, company, notes, invited_via
      ) VALUES (
        ${userId}, ${invitation.name}, ${invitation.email}, ${invitation.role},
        ${invitation.tenant_id}, ${passwordHash}, FALSE, TRUE,
        ${invitation.phone}, ${invitation.company}, ${invitation.notes},
        ${invitation.id}
      )
      RETURNING id, name, email, role
    `

    // Mark invitation as accepted
    await sql`
      UPDATE team_invitations
      SET status = 'accepted', accepted_user_id = ${userId}, accepted_at = NOW()
      WHERE id = ${invitation.id}
    `

    // Emit events (non-critical)
    try {
      await emitCustomerEvent({
        tenantId: invitation.tenant_id,
        eventType: 'account.invite_accepted',
        userId,
        entityType: 'invitation',
        entityId: invitation.id,
        description: `${invitation.name} accepted team invitation as ${invitation.role}`,
        actor: { type: 'user', id: userId, email: invitation.email },
        refs: { tenant_id: invitation.tenant_id },
        payload: {
          name: invitation.name,
          email: invitation.email,
          role: invitation.role,
        },
      })

      await emitCustomerEvent({
        tenantId: invitation.tenant_id,
        eventType: 'account.user_added',
        userId,
        entityType: 'user',
        entityId: userId,
        description: `User ${invitation.name} joined via invitation`,
        actor: { type: 'system', id: 'invite-system' },
        refs: { tenant_id: invitation.tenant_id },
        payload: { name: invitation.name, email: invitation.email, role: invitation.role },
      })
    } catch (e) {
      console.error('[POST /api/invite] Event emit error (non-critical):', e)
    }

    return NextResponse.json({
      data: {
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
        tenantSlug: invitation.tenant_slug,
        message: 'Account created successfully. You can now sign in.',
      },
    }, { status: 201 })
  } catch (error: any) {
    console.error('[POST /api/invite] Error:', error)
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'An account with this email already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create account' }, { status: 500 })
  }
}
