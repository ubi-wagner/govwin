/**
 * GET  /api/portal/[tenantSlug]/team — List team members + pending invites
 * POST /api/portal/[tenantSlug]/team — Send team invitation
 */
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[GET /api/portal/team] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[GET /api/portal/team] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const members = await sql`
      SELECT id, name, email, role, phone, company, notes,
             is_active, last_login_at, created_at
      FROM users
      WHERE tenant_id = ${tenant.id}
      ORDER BY
        CASE role WHEN 'tenant_admin' THEN 0 ELSE 1 END,
        created_at
    `

    const invitations = await sql`
      SELECT id, email, name, role, company, phone, notes,
             status, expires_at, reminder_sent_at, created_at,
             invited_by
      FROM team_invitations
      WHERE tenant_id = ${tenant.id}
        AND status IN ('pending', 'expired')
      ORDER BY created_at DESC
    `

    const [limits] = await sql`
      SELECT max_seats, max_spotlights, product_tier
      FROM tenants WHERE id = ${tenant.id}
    `

    return NextResponse.json({
      data: {
        members,
        invitations,
        limits: {
          maxSeats: limits.max_seats,
          currentSeats: members.filter((m: any) => m.is_active).length,
          pendingInvites: invitations.filter((i: any) => i.status === 'pending').length,
          productTier: limits.product_tier,
        },
      },
    })
  } catch (error) {
    console.error('[GET /api/portal/team] Error:', error)
    return NextResponse.json({ error: 'Failed to load team' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[POST /api/portal/team] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[POST /api/portal/team] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Only tenant_admin or master_admin can invite
  if (!['tenant_admin', 'master_admin'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Only admins can invite team members' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, email, role, company, phone, notes } = body

  if (!name?.trim() || !email?.trim()) {
    return NextResponse.json({ error: 'Name and email are required' }, { status: 400 })
  }

  const inviteRole = role === 'tenant_admin' ? 'tenant_admin' : 'tenant_user'

  // Check seat limit
  try {
    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*) FROM users WHERE tenant_id = ${tenant.id} AND is_active = TRUE) AS active_users,
        (SELECT COUNT(*) FROM team_invitations WHERE tenant_id = ${tenant.id} AND status = 'pending') AS pending_invites,
        t.max_seats
      FROM tenants t WHERE t.id = ${tenant.id}
    `
    const totalCommitted = Number(counts.active_users) + Number(counts.pending_invites)
    if (totalCommitted >= Number(counts.max_seats)) {
      return NextResponse.json({
        error: `Seat limit reached (${counts.max_seats} seats, ${counts.active_users} active + ${counts.pending_invites} pending). Upgrade your plan for more seats.`
      }, { status: 429 })
    }
  } catch (error) {
    console.error('[POST /api/portal/team] Seat limit check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // Check if email already exists as a user in this tenant
  try {
    const existing = await sql`
      SELECT id FROM users WHERE email = ${email.trim().toLowerCase()} AND tenant_id = ${tenant.id}
    `
    if (existing.length > 0) {
      return NextResponse.json({ error: 'A user with this email already exists on your team' }, { status: 409 })
    }
  } catch (error) {
    console.error('[POST /api/portal/team] Existing user check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  // Generate secure invite token
  const token = crypto.randomBytes(32).toString('base64url')

  try {
    const [invitation] = await sql`
      INSERT INTO team_invitations (
        tenant_id, invited_by, email, name, role,
        company, phone, notes, token
      ) VALUES (
        ${tenant.id}, ${session.user.id},
        ${email.trim().toLowerCase()}, ${name.trim()}, ${inviteRole},
        ${company ?? null}, ${phone ?? null}, ${notes ?? null},
        ${token}
      )
      RETURNING id, email, name, role, company, phone, notes, status, expires_at, created_at
    `

    // Queue welcome email notification
    try {
      await sql`
        INSERT INTO notifications_queue (
          tenant_id, user_id, notification_type, subject, body_html, body_text,
          related_ids, status, priority
        ) VALUES (
          ${tenant.id}, NULL, 'team_invitation',
          ${'You have been invited to join ' + tenant.name + ' on RFP Pipeline'},
          ${buildInviteEmailHtml(invitation.name, tenant.name, tenantSlug, token, session.user.name ?? 'Your admin')},
          ${buildInviteEmailText(invitation.name, tenant.name, tenantSlug, token, session.user.name ?? 'Your admin')},
          ${JSON.stringify({ invitation_id: invitation.id, email: email.trim().toLowerCase() })},
          'pending', 1
        )
      `
    } catch (e) {
      console.error('[POST /api/portal/team] Email queue error (non-critical):', e)
    }

    // Emit event
    try {
      await emitCustomerEvent({
        tenantId: tenant.id,
        eventType: 'account.invite_sent',
        userId: session.user.id,
        entityType: 'invitation',
        entityId: invitation.id,
        description: `Team invite sent to ${email.trim()} as ${inviteRole}`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        refs: { tenant_id: tenant.id },
        payload: { email: email.trim(), name: name.trim(), role: inviteRole },
      })
    } catch (e) {
      console.error('[POST /api/portal/team] Event emit error (non-critical):', e)
    }

    return NextResponse.json({ data: invitation }, { status: 201 })
  } catch (error: any) {
    console.error('[POST /api/portal/team] Error:', error)
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'An invitation for this email is already pending' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to send invitation' }, { status: 500 })
  }
}

function buildInviteEmailHtml(name: string, tenantName: string, slug: string, token: string, inviterName: string): string {
  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rfppipeline.com'
  const acceptUrl = `${baseUrl}/invite/${token}`

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #1e40af, #3b82f6); padding: 24px; border-radius: 12px 12px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 20px;">RFP Pipeline</h1>
      </div>
      <div style="padding: 24px; background: #ffffff; border: 1px solid #e5e7eb; border-top: none;">
        <p style="font-size: 16px; color: #111827;">Hi ${name},</p>
        <p style="color: #374151;">
          <strong>${inviterName}</strong> has invited you to join <strong>${tenantName}</strong>
          on RFP Pipeline — an AI-powered government contracting platform.
        </p>
        <p style="color: #374151;">
          Click the button below to set up your account and start collaborating
          on opportunity discovery and proposal development.
        </p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="${acceptUrl}"
             style="background: #1e40af; color: white; padding: 14px 32px; border-radius: 8px;
                    text-decoration: none; font-weight: 600; font-size: 16px; display: inline-block;">
            Accept Invitation
          </a>
        </div>
        <p style="color: #6b7280; font-size: 13px;">
          This invitation expires in 7 days. If you didn't expect this email, you can safely ignore it.
        </p>
        <p style="color: #9ca3af; font-size: 12px; margin-top: 24px; border-top: 1px solid #e5e7eb; padding-top: 16px;">
          Or copy this link: ${acceptUrl}
        </p>
      </div>
    </div>
  `
}

function buildInviteEmailText(name: string, tenantName: string, slug: string, token: string, inviterName: string): string {
  const baseUrl = process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.rfppipeline.com'
  const acceptUrl = `${baseUrl}/invite/${token}`

  return `Hi ${name},

${inviterName} has invited you to join ${tenantName} on RFP Pipeline.

Accept your invitation here: ${acceptUrl}

This invitation expires in 7 days.`
}
