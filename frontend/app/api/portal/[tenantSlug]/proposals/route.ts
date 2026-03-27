/**
 * GET  /api/portal/[tenantSlug]/proposals — List proposals for tenant
 * POST /api/portal/[tenantSlug]/proposals — Create new proposal
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string }> }

const STAGE_COLORS: Record<string, string> = {
  outline: 'gray',
  draft: 'blue',
  pink_team: 'pink',
  red_team: 'red',
  gold_team: 'gold',
  final: 'green',
  submitted: 'purple',
  archived: 'slate',
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[GET /api/portal/proposals] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[GET /api/portal/proposals] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const proposals = await sql`
      SELECT
        p.id, p.title, p.status, p.stage, p.stage_color,
        p.stage_entered_at, p.stage_deadline, p.submission_deadline,
        p.workspace_locked, p.completion_pct, p.section_count,
        p.sections_populated, p.sections_approved,
        p.outcome, p.created_by, p.created_at, p.updated_at,
        o.title AS opportunity_title, o.agency, o.solicitation_number,
        o.close_date, o.set_aside_type,
        u.name AS created_by_name,
        (SELECT COUNT(*) FROM proposal_collaborators pc
         WHERE pc.proposal_id = p.id AND pc.is_active = TRUE)::INT AS collaborator_count,
        (SELECT COUNT(*) FROM proposal_comments cm
         WHERE cm.proposal_id = p.id AND cm.is_resolved = FALSE)::INT AS open_comments,
        (SELECT COUNT(*) FROM proposal_workspace_files wf
         WHERE wf.proposal_id = p.id)::INT AS file_count
      FROM proposals p
      LEFT JOIN opportunities o ON p.opportunity_id = o.id
      LEFT JOIN users u ON p.created_by = u.id
      WHERE p.tenant_id = ${tenant.id}
      ORDER BY
        CASE WHEN p.status = 'archived' THEN 1 ELSE 0 END,
        p.updated_at DESC
    `

    return NextResponse.json({ data: proposals })
  } catch (error) {
    console.error('[GET /api/portal/proposals] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
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
    console.error('[POST /api/portal/proposals] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[POST /api/portal/proposals] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Only tenant_admin or master_admin can create proposals
  if (session.user.role !== 'tenant_admin' && session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Only admins can create proposals' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { title, opportunityId, submissionDeadline } = body
  if (!title || !opportunityId) {
    return NextResponse.json({ error: 'title and opportunityId are required' }, { status: 400 })
  }

  try {
    // Verify the opportunity exists
    const oppRows = await sql`
      SELECT id, title, close_date FROM opportunities WHERE id = ${opportunityId}
    `
    if (oppRows.length === 0) {
      return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 })
    }

    const [proposal] = await sql`
      INSERT INTO proposals (
        tenant_id, opportunity_id, title, status, stage, stage_color,
        submission_deadline, created_by
      ) VALUES (
        ${tenant.id}, ${opportunityId}, ${title}, 'draft', 'outline', 'gray',
        ${submissionDeadline ?? oppRows[0].closeDate ?? null},
        ${session.user.id}
      )
      RETURNING *
    `

    // Auto-add creator as owner collaborator
    await sql`
      INSERT INTO proposal_collaborators (proposal_id, user_id, role, invited_by, accepted_at, permissions)
      VALUES (
        ${proposal.id}, ${session.user.id}, 'owner', ${session.user.id}, NOW(),
        '{"can_edit": true, "can_comment": true, "can_review": true, "can_approve": true, "can_upload": true, "can_manage_team": true, "can_lock": true, "can_export": true}'::jsonb
      )
    `

    // Record stage history
    await sql`
      INSERT INTO proposal_stage_history (proposal_id, to_stage, to_color, changed_by, reason)
      VALUES (${proposal.id}, 'outline', 'gray', ${session.user.id}, 'Proposal created')
    `

    // Record activity
    await sql`
      INSERT INTO proposal_activity (proposal_id, user_id, activity_type, summary)
      VALUES (${proposal.id}, ${session.user.id}, 'stage_changed', ${`Proposal "${title}" created`})
    `

    await emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'proposal.created',
      userId: session.user.id,
      entityType: 'proposal',
      entityId: proposal.id,
      description: `Proposal "${title}" created for opportunity "${oppRows[0].title}"`,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      payload: {
        proposalId: proposal.id,
        opportunityId,
        title,
      },
    })

    return NextResponse.json({ data: proposal }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/portal/proposals] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
