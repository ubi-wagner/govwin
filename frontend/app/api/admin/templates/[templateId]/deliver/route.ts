/**
 * POST /api/admin/templates/[templateId]/deliver
 * Deliver a master template to a customer's proposal workspace.
 *
 * Critical path: reads template sections JSONB, creates proposal_sections,
 * updates purchase status, and emits tenant-scoped customer events.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'
import { emitCustomerEvent } from '@/lib/events'

type RouteContext = { params: Promise<{ templateId: string }> }

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { templateId } = await context.params

  if (!templateId) {
    return NextResponse.json({ error: 'templateId is required' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { purchaseId, proposalId, tenantId } = body as {
    purchaseId?: string
    proposalId?: string
    tenantId?: string
  }

  if (!purchaseId || !proposalId || !tenantId) {
    return NextResponse.json(
      { error: 'purchaseId, proposalId, and tenantId are required' },
      { status: 400 }
    )
  }

  try {
    // 1. Validate purchase exists and is pending
    const [purchase] = await sql`
      SELECT id, status, tenant_id, proposal_id
      FROM proposal_purchases
      WHERE id = ${purchaseId}
    `

    if (!purchase) {
      return NextResponse.json({ error: 'Purchase not found' }, { status: 404 })
    }

    if (purchase.status !== 'pending') {
      return NextResponse.json(
        { error: `Purchase status is '${purchase.status}', expected 'pending'` },
        { status: 409 }
      )
    }

    // 2. Validate proposal exists
    const [proposal] = await sql`
      SELECT id, title FROM proposals
      WHERE id = ${proposalId}
    `

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
    }

    // 3. Read template sections
    const [template] = await sql`
      SELECT id, sections, template_name, agency, program_type
      FROM master_templates
      WHERE id = ${templateId}
    `

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    // JSONB contents are NOT transformed by postgres.toCamel — keys may be
    // snake_case (seed data) or camelCase (API-created). Handle both.
    const sections = (template.sections ?? []) as Array<{
      key: string
      title: string
      instructions?: string
      page_limit?: number
      pageLimit?: number
      required?: boolean
      sort_order?: number
      sortOrder?: number
    }>

    if (!Array.isArray(sections) || sections.length === 0) {
      return NextResponse.json(
        { error: 'Template has no sections to deliver' },
        { status: 400 }
      )
    }

    // 4. Create proposal_sections from template sections
    let sectionsCreated = 0
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i]
      const pageLimit = section.pageLimit ?? section.page_limit ?? null
      try {
        await sql`
          INSERT INTO proposal_sections (
            proposal_id, section_key, title, instructions,
            page_limit, required, sort_order, status
          ) VALUES (
            ${proposalId},
            ${section.key},
            ${section.title},
            ${section.instructions ?? null},
            ${pageLimit},
            ${section.required !== false},
            ${i},
            'empty'
          )
          ON CONFLICT (proposal_id, section_key) DO NOTHING
        `
        sectionsCreated++
      } catch (sectionError) {
        console.error(`[POST /api/admin/templates/[templateId]/deliver] Failed to insert section ${section.key}:`, sectionError)
      }
    }

    // 5. Update purchase status
    await sql`
      UPDATE proposal_purchases
      SET
        status = 'template_delivered',
        template_delivered_at = NOW(),
        template_id = ${templateId},
        delivered_by = ${session.user.id},
        updated_at = NOW()
      WHERE id = ${purchaseId}
    `

    // 6. Update proposal with template reference
    await sql`
      UPDATE proposals
      SET template_source_id = ${templateId}, updated_at = NOW()
      WHERE id = ${proposalId}
    `

    // 7. Emit customer events (non-critical)
    await emitCustomerEvent({
      tenantId,
      eventType: 'purchase.template_delivered',
      userId: session.user.id,
      entityType: 'proposal_purchase',
      entityId: purchaseId,
      description: `Template "${template.templateName}" delivered to proposal by ${session.user.name ?? 'admin'}`,
      actor: {
        type: 'user',
        id: session.user.id,
        email: session.user.email ?? undefined,
      },
      refs: {
        proposalId,
        templateId,
        purchaseId,
      },
      payload: {
        templateName: template.templateName,
        agency: template.agency,
        programType: template.programType,
        sectionsCreated,
      },
    })

    await emitCustomerEvent({
      tenantId,
      eventType: 'proposal.section_populated',
      userId: session.user.id,
      entityType: 'proposal',
      entityId: proposalId,
      description: `${sectionsCreated} sections populated from template "${template.templateName}"`,
      actor: {
        type: 'user',
        id: session.user.id,
        email: session.user.email ?? undefined,
      },
      refs: {
        proposalId,
        templateId,
      },
      payload: {
        sectionCount: sectionsCreated,
        templateName: template.templateName,
        source: 'template_delivery',
      },
    })

    return NextResponse.json({
      data: { delivered: true, sectionsCreated },
    })
  } catch (error) {
    console.error('[POST /api/admin/templates/[templateId]/deliver] Error:', error)
    return NextResponse.json({ error: 'Failed to deliver template' }, { status: 500 })
  }
}
