/**
 * GET   /api/portal/[tenantSlug]/proposals/[proposalId] — Proposal detail + workspace data
 * PATCH /api/portal/[tenantSlug]/proposals/[proposalId] — Update proposal (stage, title, deadline)
 * DELETE /api/portal/[tenantSlug]/proposals/[proposalId] — Archive proposal
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string; proposalId: string }> }

const STAGE_ORDER = ['outline', 'draft', 'pink_team', 'red_team', 'gold_team', 'final', 'submitted', 'archived'] as const
const STAGE_COLORS: Record<string, string> = {
  outline: 'gray', draft: 'blue', pink_team: 'pink', red_team: 'red',
  gold_team: 'gold', final: 'green', submitted: 'purple', archived: 'slate',
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug, proposalId } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[GET /api/portal/proposals/[id]] Tenant error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[GET /api/portal/proposals/[id]] Access error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    // Main proposal data
    const proposalRows = await sql`
      SELECT
        p.*,
        o.title AS opportunity_title, o.agency, o.solicitation_number,
        o.close_date, o.set_aside_type, o.source_url,
        o.description AS opportunity_description
      FROM proposals p
      LEFT JOIN opportunities o ON p.opportunity_id = o.id
      WHERE p.id = ${proposalId} AND p.tenant_id = ${tenant.id}
    `
    if (proposalRows.length === 0) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    const proposal = proposalRows[0]

    // Fetch related data in parallel
    const [sections, collaborators, activity, stageHistory, files, openComments] = await Promise.all([
      sql`
        SELECT id, section_key, title, status, content, sort_order,
               page_limit, current_page_count, page_status, updated_at
        FROM proposal_sections
        WHERE proposal_id = ${proposalId}
        ORDER BY sort_order
      `,
      sql`
        SELECT pc.id, pc.user_id, pc.role, pc.permissions, pc.is_active,
               pc.assigned_sections, pc.created_at,
               u.name, u.email
        FROM proposal_collaborators pc
        JOIN users u ON pc.user_id = u.id
        WHERE pc.proposal_id = ${proposalId} AND pc.is_active = TRUE
        ORDER BY pc.role, u.name
      `,
      sql`
        SELECT pa.id, pa.activity_type, pa.summary, pa.detail, pa.is_system,
               pa.created_at, u.name AS user_name
        FROM proposal_activity pa
        LEFT JOIN users u ON pa.user_id = u.id
        WHERE pa.proposal_id = ${proposalId}
        ORDER BY pa.created_at DESC
        LIMIT 50
      `,
      sql`
        SELECT id, from_stage, to_stage, from_color, to_color, reason, created_at,
               (SELECT name FROM users WHERE id = psh.changed_by) AS changed_by_name
        FROM proposal_stage_history psh
        WHERE proposal_id = ${proposalId}
        ORDER BY created_at DESC
        LIMIT 20
      `,
      sql`
        SELECT id, file_name, file_type, file_size_bytes, version, description,
               is_submission_artifact, tags, created_at,
               (SELECT name FROM users WHERE id = pwf.uploaded_by) AS uploaded_by_name
        FROM proposal_workspace_files pwf
        WHERE proposal_id = ${proposalId}
        ORDER BY created_at DESC
        LIMIT 50
      `,
      sql`
        SELECT COUNT(*)::INT AS count
        FROM proposal_comments
        WHERE proposal_id = ${proposalId} AND is_resolved = FALSE
      `,
    ])

    return NextResponse.json({
      data: {
        ...proposal,
        sections,
        collaborators,
        activity,
        stageHistory,
        files,
        openComments: openComments[0]?.count ?? 0,
      }
    })
  } catch (error) {
    console.error('[GET /api/portal/proposals/[id]] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug, proposalId } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[PATCH /api/portal/proposals/[id]] Tenant error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[PATCH /api/portal/proposals/[id]] Access error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { title, stage, submissionDeadline, stageDeadline, reason } = body

  try {
    // Get current state
    const [current] = await sql`
      SELECT id, stage, stage_color, title FROM proposals
      WHERE id = ${proposalId} AND tenant_id = ${tenant.id}
    `
    if (!current) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // If advancing stage, record history
    if (stage && stage !== current.stage) {
      const newColor = STAGE_COLORS[stage] ?? 'gray'

      await sql`
        UPDATE proposals
        SET stage = ${stage}, stage_color = ${newColor},
            stage_entered_at = NOW(), stage_deadline = ${stageDeadline ?? null},
            updated_at = NOW()
        WHERE id = ${proposalId}
      `

      await sql`
        INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, from_color, to_color, changed_by, reason)
        VALUES (${proposalId}, ${current.stage}, ${stage}, ${current.stageColor}, ${newColor}, ${session.user.id}, ${reason ?? null})
      `

      await sql`
        INSERT INTO proposal_activity (proposal_id, user_id, activity_type, summary, detail)
        VALUES (${proposalId}, ${session.user.id}, 'stage_changed',
          ${`Stage changed from ${current.stage} to ${stage}`},
          ${JSON.stringify({ from: current.stage, to: stage, reason: reason ?? null })}::jsonb)
      `
    }

    // Update other fields
    const [updated] = await sql`
      UPDATE proposals
      SET
        title = COALESCE(${title ?? null}, title),
        submission_deadline = COALESCE(${submissionDeadline ?? null}, submission_deadline),
        updated_at = NOW()
      WHERE id = ${proposalId} AND tenant_id = ${tenant.id}
      RETURNING *
    `

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[PATCH /api/portal/proposals/[id]] Error:', error)
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
    console.error('[DELETE /api/portal/proposals/[id]] Tenant error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[DELETE /api/portal/proposals/[id]] Access error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (session.user.role !== 'tenant_admin' && session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Only admins can archive proposals' }, { status: 403 })
  }

  try {
    const [archived] = await sql`
      UPDATE proposals
      SET status = 'archived', stage = 'archived', stage_color = 'slate', updated_at = NOW()
      WHERE id = ${proposalId} AND tenant_id = ${tenant.id}
      RETURNING id, title
    `
    if (!archived) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    await sql`
      INSERT INTO proposal_stage_history (proposal_id, to_stage, to_color, changed_by, reason)
      VALUES (${proposalId}, 'archived', 'slate', ${session.user.id}, 'Archived by admin')
    `

    await sql`
      INSERT INTO proposal_activity (proposal_id, user_id, activity_type, summary)
      VALUES (${proposalId}, ${session.user.id}, 'stage_changed', ${`Proposal "${archived.title}" archived`})
    `

    return NextResponse.json({ data: archived, message: 'Proposal archived' })
  } catch (error) {
    console.error('[DELETE /api/portal/proposals/[id]] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
