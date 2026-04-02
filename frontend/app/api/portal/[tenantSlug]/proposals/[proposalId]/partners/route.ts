/**
 * GET    /api/portal/[tenantSlug]/proposals/[proposalId]/partners — List partners for proposal
 * POST   /api/portal/[tenantSlug]/proposals/[proposalId]/partners — Invite partner
 * DELETE /api/portal/[tenantSlug]/proposals/[proposalId]/partners — Revoke partner access
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'
import crypto from 'crypto'

type Params = { params: Promise<{ tenantSlug: string; proposalId: string }> }

const DEFAULT_PERMISSIONS = {
  default: 'view' as const,
  sections: {},
  uploads: { can_upload: false, can_delete_own: false, can_view_all: false, can_view_shared: true },
  library: { can_access: false },
  proposal: { can_view_metadata: true, can_advance_stage: false, can_export: false },
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug, proposalId } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[GET /api/portal/proposals/[id]/partners] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[GET /api/portal/proposals/[id]/partners] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const grants = await sql`
      SELECT
        pag.id, pag.user_id, pag.tenant_id, pag.proposal_id,
        pag.status, pag.permissions, pag.access_scope,
        pag.expires_at, pag.accepted_at, pag.approved_at,
        pag.revoked_at, pag.created_at,
        u.name AS user_name, u.email AS user_email
      FROM partner_access_grants pag
      JOIN users u ON pag.user_id = u.id
      WHERE pag.proposal_id = ${proposalId}
        AND pag.tenant_id = ${tenant.id}
      ORDER BY
        CASE pag.status
          WHEN 'active' THEN 0
          WHEN 'pending_acceptance' THEN 1
          WHEN 'pending_approval' THEN 2
          WHEN 'expired' THEN 3
          WHEN 'revoked' THEN 4
          WHEN 'rejected' THEN 5
        END,
        pag.created_at DESC
    `

    return NextResponse.json({ data: grants })
  } catch (error) {
    console.error('[GET /api/portal/proposals/[id]/partners] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug, proposalId } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[POST /api/portal/proposals/[id]/partners] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[POST /api/portal/proposals/[id]/partners] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Only tenant_admin or master_admin can invite partners
  if (session.user.role !== 'tenant_admin' && session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Only admins can invite partners' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { email, name, permissions, accessScope } = body

  if (!email || !name) {
    return NextResponse.json({ error: 'email and name are required' }, { status: 400 })
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'Invalid email format' }, { status: 400 })
  }

  try {
    // Verify proposal belongs to tenant
    const [proposal] = await sql`
      SELECT id, title FROM proposals WHERE id = ${proposalId} AND tenant_id = ${tenant.id}
    `
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // Check if user with this email already exists
    const [existingUser] = await sql`
      SELECT id, role, tenant_id, is_active FROM users WHERE email = ${email.toLowerCase()}
    `

    let partnerId: string

    if (existingUser) {
      // If existing user is NOT a partner_user, can't make them one
      if (existingUser.role !== 'partner_user') {
        return NextResponse.json(
          { error: 'This email belongs to an existing tenant user and cannot be added as a partner' },
          { status: 409 }
        )
      }

      // Check for duplicate active grant
      const [existingGrant] = await sql`
        SELECT id FROM partner_access_grants
        WHERE user_id = ${existingUser.id}
          AND proposal_id = ${proposalId}
          AND tenant_id = ${tenant.id}
          AND status NOT IN ('revoked', 'rejected', 'expired')
      `
      if (existingGrant) {
        return NextResponse.json(
          { error: 'This partner already has an active or pending grant for this proposal' },
          { status: 409 }
        )
      }

      partnerId = existingUser.id
    } else {
      // Create new user with partner_user role
      const tempPassword = crypto.randomBytes(16).toString('hex')
      const [newUser] = await sql`
        INSERT INTO users (name, email, role, tenant_id, is_active, temp_password)
        VALUES (${name}, ${email.toLowerCase()}, 'partner_user', ${tenant.id}, true, true)
        RETURNING id
      `
      partnerId = newUser.id
    }

    // Merge permissions with defaults
    const mergedPermissions = permissions
      ? { ...DEFAULT_PERMISSIONS, ...permissions }
      : DEFAULT_PERMISSIONS
    const scope = accessScope ?? 'proposal_only'

    // Create partner_access_grants row
    const [grant] = await sql`
      INSERT INTO partner_access_grants (
        user_id, tenant_id, proposal_id, granted_by,
        status, permissions, access_scope
      ) VALUES (
        ${partnerId},
        ${tenant.id},
        ${proposalId},
        ${session.user.id},
        'pending_acceptance',
        ${JSON.stringify(mergedPermissions)}::jsonb,
        ${scope}
      )
      RETURNING *
    `

    // Create team_invitations row for the invite email flow
    const inviteToken = crypto.randomBytes(32).toString('hex')
    const [invitation] = await sql`
      INSERT INTO team_invitations (
        tenant_id, invited_by, email, name, role, token, status, expires_at
      ) VALUES (
        ${tenant.id},
        ${session.user.id},
        ${email.toLowerCase()},
        ${name},
        'partner_user',
        ${inviteToken},
        'pending',
        NOW() + interval '7 days'
      )
      RETURNING id, token, status, expires_at
    `

    // Also create a proposal_collaborators row (inactive until accepted)
    await sql`
      INSERT INTO proposal_collaborators (
        proposal_id, user_id, role, is_partner, invited_by, is_active,
        permissions
      ) VALUES (
        ${proposalId},
        ${partnerId},
        'viewer',
        true,
        ${session.user.id},
        false,
        ${JSON.stringify(mergedPermissions)}::jsonb
      )
      ON CONFLICT (proposal_id, user_id) DO UPDATE
      SET is_partner = true, permissions = ${JSON.stringify(mergedPermissions)}::jsonb
    `

    await emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'partner.invited',
      userId: session.user.id,
      entityType: 'partner_access_grant',
      entityId: grant.id,
      description: `Partner "${name}" (${email}) invited to proposal "${proposal.title}"`,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      payload: {
        grantId: grant.id,
        partnerUserId: partnerId,
        partnerEmail: email,
        proposalId,
        accessScope: scope,
      },
    })

    return NextResponse.json({ data: { grant, invitation } }, { status: 201 })
  } catch (error: any) {
    // Handle unique constraint violations
    if (error?.code === '23505') {
      return NextResponse.json(
        { error: 'A partner invitation for this email already exists' },
        { status: 409 }
      )
    }
    console.error('[POST /api/portal/proposals/[id]/partners] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug, proposalId } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[DELETE /api/portal/proposals/[id]/partners] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[DELETE /api/portal/proposals/[id]/partners] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Only tenant_admin or master_admin can revoke
  if (session.user.role !== 'tenant_admin' && session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Only admins can revoke partner access' }, { status: 403 })
  }

  const grantId = request.nextUrl.searchParams.get('grantId')
  if (!grantId) {
    return NextResponse.json({ error: 'grantId query parameter is required' }, { status: 400 })
  }

  try {
    // Verify grant exists and belongs to this tenant/proposal
    const [grant] = await sql`
      SELECT id, user_id, status
      FROM partner_access_grants
      WHERE id = ${grantId}
        AND proposal_id = ${proposalId}
        AND tenant_id = ${tenant.id}
    `

    if (!grant) {
      return NextResponse.json({ error: 'Grant not found' }, { status: 404 })
    }

    if (grant.status === 'revoked') {
      return NextResponse.json({ error: 'Grant is already revoked' }, { status: 409 })
    }

    // Revoke the grant
    await sql`
      UPDATE partner_access_grants
      SET status = 'revoked', revoked_at = NOW(), revoked_by = ${session.user.id}
      WHERE id = ${grantId}
    `

    // Deactivate the collaborator row
    await sql`
      UPDATE proposal_collaborators
      SET is_active = false
      WHERE proposal_id = ${proposalId}
        AND user_id = ${grant.userId}
        AND is_partner = true
    `

    await emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'partner.revoked',
      userId: session.user.id,
      entityType: 'partner_access_grant',
      entityId: grantId,
      description: `Partner access revoked for grant ${grantId}`,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      payload: {
        grantId,
        partnerUserId: grant.userId,
        proposalId,
      },
    })

    return NextResponse.json({ data: { revoked: true } })
  } catch (error) {
    console.error('[DELETE /api/portal/proposals/[id]/partners] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
