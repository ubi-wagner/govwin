/**
 * GET   /api/portal/[tenantSlug]/proposals/[proposalId]/sections — List all sections for a proposal
 * POST  /api/portal/[tenantSlug]/proposals/[proposalId]/sections — Create section or auto-populate from template
 * PATCH /api/portal/[tenantSlug]/proposals/[proposalId]/sections — Bulk update sections (reorder, content save)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string; proposalId: string }> }

// ── Helpers ─────────────────────────────────────────────────

/** Strip HTML tags, then count words by splitting on whitespace. */
function computeContentStats(content: string | null | undefined) {
  if (!content) return { wordCount: 0, charCount: 0, estPageCount: 0 }
  const plain = content.replace(/<[^>]*>/g, '')
  const trimmed = plain.trim()
  const charCount = trimmed.length
  const wordCount = trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
  // Approximate: ~250 words per page
  const estPageCount = Math.round((wordCount / 250) * 100) / 100
  return { wordCount, charCount, estPageCount }
}

// ── Auth + tenant + proposal guard ──────────────────────────

async function authorize(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { tenantSlug, proposalId } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[sections] Tenant lookup error:', error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant not found' }, { status: 404 }) }
  }

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[sections] Access check error:', error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!hasAccess) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  // Verify proposal belongs to this tenant
  let proposal: any
  try {
    const rows = await sql`
      SELECT id FROM proposals WHERE id = ${proposalId} AND tenant_id = ${tenant.id}
    `
    proposal = rows[0] ?? null
  } catch (error) {
    console.error('[sections] Proposal lookup error:', error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!proposal) {
    return { error: NextResponse.json({ error: 'Proposal not found' }, { status: 404 }) }
  }

  return { session, tenant, proposalId }
}

// ── GET — List sections ─────────────────────────────────────

export async function GET(request: NextRequest, ctx: Params) {
  const result = await authorize(request, ctx)
  if ('error' in result) return result.error

  const { proposalId } = result

  try {
    const sections = await sql`
      SELECT id, proposal_id, section_key, title, sort_order, page_limit,
             instructions, content_draft, content_final, status,
             ai_confidence, ai_match_summary, word_count, char_count,
             est_page_count, page_status, refinement_count, reviewed_by,
             created_at, updated_at
      FROM proposal_sections
      WHERE proposal_id = ${proposalId}
      ORDER BY sort_order ASC
    `

    return NextResponse.json({ data: sections })
  } catch (error) {
    console.error('[GET /api/portal/proposals/[id]/sections] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

// ── POST — Create section or auto-populate from template ────

export async function POST(request: NextRequest, ctx: Params) {
  const result = await authorize(request, ctx)
  if ('error' in result) return result.error

  const { session, tenant, proposalId } = result

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // ── Mode 2: Auto-populate from RFP template ──────────────
  if (body.fromTemplate === true) {
    try {
      // Get the proposal's rfp_template_id
      const [proposal] = await sql`
        SELECT rfp_template_id FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenant.id}
      `
      if (!proposal?.rfpTemplateId) {
        return NextResponse.json({ error: 'Proposal has no linked RFP template' }, { status: 400 })
      }

      // Fetch the template sections JSONB
      const [template] = await sql`
        SELECT sections FROM rfp_templates WHERE id = ${proposal.rfpTemplateId}
      `
      if (!template?.sections || !Array.isArray(template.sections)) {
        return NextResponse.json({ error: 'RFP template has no sections defined' }, { status: 400 })
      }

      // Check for existing sections to avoid duplicates
      const existing = await sql`
        SELECT id FROM proposal_sections WHERE proposal_id = ${proposalId} LIMIT 1
      `
      if (existing.length > 0) {
        return NextResponse.json({ error: 'Sections already exist for this proposal. Delete existing sections before re-populating.' }, { status: 409 })
      }

      // Insert one proposal_section per template section
      const templateSections = template.sections as Array<{
        key?: string
        title?: string
        instructions?: string
        pageLimit?: number
        sortOrder?: number
      }>

      const insertedSections = []
      for (let i = 0; i < templateSections.length; i++) {
        const ts = templateSections[i]
        const [inserted] = await sql`
          INSERT INTO proposal_sections
            (proposal_id, section_key, title, sort_order, page_limit, instructions, status)
          VALUES (
            ${proposalId},
            ${ts.key ?? `section_${i + 1}`},
            ${ts.title ?? `Section ${i + 1}`},
            ${ts.sortOrder ?? i + 1},
            ${ts.pageLimit ?? null},
            ${ts.instructions ?? null},
            'empty'
          )
          RETURNING *
        `
        insertedSections.push(inserted)
      }

      // Emit event (non-critical)
      emitCustomerEvent({
        tenantId: tenant.id,
        eventType: 'proposal.section_populated' as any,
        userId: session.user.id,
        entityType: 'proposal',
        entityId: proposalId,
        description: `Auto-populated ${insertedSections.length} sections from RFP template`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        payload: { proposalId, templateId: proposal.rfpTemplateId, sectionCount: insertedSections.length },
      }).catch(e => console.error('[POST /api/portal/proposals/[id]/sections] Event emission error (non-critical):', e))

      return NextResponse.json({ data: insertedSections }, { status: 201 })
    } catch (error: any) {
      if (error?.code === '23505') {
        return NextResponse.json({ error: 'Duplicate section key detected' }, { status: 409 })
      }
      console.error('[POST /api/portal/proposals/[id]/sections] Template populate error:', error)
      return NextResponse.json({ error: 'Database error' }, { status: 500 })
    }
  }

  // ── Mode 1: Manual create ────────────────────────────────
  const { title, sectionKey, instructions, pageLimit, sortOrder } = body

  if (!title || typeof title !== 'string') {
    return NextResponse.json({ error: 'title is required' }, { status: 400 })
  }
  if (!sectionKey || typeof sectionKey !== 'string') {
    return NextResponse.json({ error: 'sectionKey is required' }, { status: 400 })
  }

  try {
    // Default sort_order to max + 1 if not provided
    let effectiveSortOrder = sortOrder
    if (effectiveSortOrder == null) {
      const [maxRow] = await sql`
        SELECT COALESCE(MAX(sort_order), 0) + 1 AS next_order
        FROM proposal_sections
        WHERE proposal_id = ${proposalId}
      `
      effectiveSortOrder = maxRow?.nextOrder ?? 1
    }

    const [section] = await sql`
      INSERT INTO proposal_sections
        (proposal_id, section_key, title, sort_order, page_limit, instructions, status)
      VALUES (
        ${proposalId},
        ${sectionKey},
        ${title},
        ${effectiveSortOrder},
        ${pageLimit ?? null},
        ${instructions ?? null},
        'empty'
      )
      RETURNING *
    `

    return NextResponse.json({ data: section }, { status: 201 })
  } catch (error: any) {
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'A section with this key already exists for this proposal' }, { status: 409 })
    }
    console.error('[POST /api/portal/proposals/[id]/sections] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

// ── PATCH — Bulk update sections ────────────────────────────

export async function PATCH(request: NextRequest, ctx: Params) {
  const result = await authorize(request, ctx)
  if ('error' in result) return result.error

  const { session, tenant, proposalId } = result

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { sections } = body
  if (!Array.isArray(sections) || sections.length === 0) {
    return NextResponse.json({ error: 'sections array is required and must not be empty' }, { status: 400 })
  }

  // Validate each entry has an id
  for (const s of sections) {
    if (!s.id || typeof s.id !== 'string') {
      return NextResponse.json({ error: 'Each section must have a valid id' }, { status: 400 })
    }
  }

  try {
    const updatedSections = []

    for (const s of sections) {
      const hasContent = s.content_draft !== undefined
      const hasSortOrder = s.sort_order !== undefined
      const hasStatus = s.status !== undefined

      if (!hasContent && !hasSortOrder && !hasStatus) {
        continue // Nothing to update for this entry
      }

      // Build the update
      let stats: { wordCount: number; charCount: number; estPageCount: number } | null = null
      if (hasContent) {
        stats = computeContentStats(s.content_draft)
      }

      const [updated] = await sql`
        UPDATE proposal_sections
        SET
          content_draft = ${hasContent ? s.content_draft : sql`content_draft`},
          sort_order = ${hasSortOrder ? s.sort_order : sql`sort_order`},
          status = ${hasStatus ? s.status : sql`status`},
          word_count = ${stats ? stats.wordCount : sql`word_count`},
          char_count = ${stats ? stats.charCount : sql`char_count`},
          est_page_count = ${stats ? stats.estPageCount : sql`est_page_count`},
          updated_at = NOW()
        WHERE id = ${s.id} AND proposal_id = ${proposalId}
        RETURNING *
      `

      if (!updated) {
        return NextResponse.json(
          { error: `Section ${s.id} not found in this proposal` },
          { status: 404 }
        )
      }

      updatedSections.push(updated)

      // Record history for content changes
      if (hasContent) {
        await sql`
          INSERT INTO proposal_section_history
            (section_id, proposal_id, content, change_type, changed_by, change_summary)
          VALUES (
            ${s.id},
            ${proposalId},
            ${s.content_draft},
            'user_edit',
            ${session.user.id},
            ${`Content updated (${stats?.wordCount ?? 0} words)`}
          )
        `

        // Emit event (non-critical)
        emitCustomerEvent({
          tenantId: tenant.id,
          eventType: 'proposal.section_refined' as any,
          userId: session.user.id,
          entityType: 'proposal_section',
          entityId: s.id,
          description: `Section content updated (${stats?.wordCount ?? 0} words)`,
          actor: userActor(session.user.id, session.user.email ?? undefined),
          payload: {
            proposalId,
            sectionId: s.id,
            wordCount: stats?.wordCount ?? 0,
            charCount: stats?.charCount ?? 0,
          },
        }).catch(e => console.error('[PATCH /api/portal/proposals/[id]/sections] Event emission error (non-critical):', e))
      }
    }

    return NextResponse.json({ data: updatedSections })
  } catch (error) {
    console.error('[PATCH /api/portal/proposals/[id]/sections] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
