/**
 * DELETE /api/portal/[tenantSlug]/team/[invitationId] — Revoke a pending invitation
 * POST   /api/portal/[tenantSlug]/team/[invitationId] — Resend invitation email
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string; invitationId: string }> }

async function resolveContext(session: any, slug: string, invitationId: string, routeTag: string) {
  let tenant: any
  try {
    tenant = await getTenantBySlug(slug)
  } catch (error) {
    console.error(`[${routeTag}] Tenant resolution error:`, error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) }

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error(`[${routeTag}] Access check error:`, error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!hasAccess) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  let invitation: any
  try {
    const [row] = await sql`
      SELECT * FROM team_invitations WHERE id = ${invitationId} AND tenant_id = ${tenant.id}
    `
    invitation = row
  } catch (error) {
    console.error(`[${routeTag}] Invitation fetch error:`, error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!invitation) return { error: NextResponse.json({ error: 'Invitation not found' }, { status: 404 }) }

  return { tenant, invitation }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!['tenant_admin', 'master_admin'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Only admins can revoke invitations' }, { status: 403 })
  }

  const { tenantSlug, invitationId } = await params
  const result = await resolveContext(session, tenantSlug, invitationId, 'DELETE /api/portal/team/[id]')
  if (result.error) return result.error
  const { tenant, invitation } = result

  if (invitation.status !== 'pending') {
    return NextResponse.json({ error: 'Can only revoke pending invitations' }, { status: 400 })
  }

  try {
    await sql`
      UPDATE team_invitations SET status = 'revoked'
      WHERE id = ${invitationId} AND tenant_id = ${tenant.id}
    `

    await emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'account.invite_expired',
      userId: session.user.id,
      entityType: 'invitation',
      entityId: invitationId,
      description: `Invitation to ${invitation.email} revoked`,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      payload: { invitationId, email: invitation.email, action: 'revoked' },
    }).catch(e => console.error('[DELETE /api/portal/team/[id]] Event error (non-critical):', e))

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[DELETE /api/portal/team/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 })
  }
}

export async function POST(_request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!['tenant_admin', 'master_admin'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Only admins can resend invitations' }, { status: 403 })
  }

  const { tenantSlug, invitationId } = await params
  const result = await resolveContext(session, tenantSlug, invitationId, 'POST /api/portal/team/[id]')
  if (result.error) return result.error
  const { tenant, invitation } = result

  if (!['pending', 'expired'].includes(invitation.status)) {
    return NextResponse.json({ error: 'Can only resend pending or expired invitations' }, { status: 400 })
  }

  try {
    // Reset expiry and status
    await sql`
      UPDATE team_invitations
      SET status = 'pending',
          expires_at = NOW() + INTERVAL '7 days',
          reminder_sent_at = NOW()
      WHERE id = ${invitationId} AND tenant_id = ${tenant.id}
    `

    // Queue notification email
    try {
      await sql`
        INSERT INTO notifications_queue (
          tenant_id, user_id, notification_type, subject, body_text,
          related_ids, status, priority
        ) VALUES (
          ${tenant.id}, NULL, 'team_invitation_resend',
          ${'Reminder: You have been invited to join ' + tenant.name + ' on RFP Pipeline'},
          ${'This is a reminder that you have been invited. Check your original email for the invitation link.'},
          ${JSON.stringify({ invitation_id: invitationId, email: invitation.email })},
          'pending', 2
        )
      `
    } catch (e) {
      console.error('[POST /api/portal/team/[id]] Email queue error (non-critical):', e)
    }

    await emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'account.invite_sent',
      userId: session.user.id,
      entityType: 'invitation',
      entityId: invitationId,
      description: `Invitation to ${invitation.email} resent`,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      payload: { invitationId, email: invitation.email, action: 'resent' },
    }).catch(e => console.error('[POST /api/portal/team/[id]] Event error (non-critical):', e))

    return NextResponse.json({ data: { success: true, message: 'Invitation resent' } })
  } catch (error) {
    console.error('[POST /api/portal/team/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to resend invitation' }, { status: 500 })
  }
}
