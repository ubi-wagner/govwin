/**
 * GET  /api/admin/templates — List all master templates
 * POST /api/admin/templates — Create a new master template
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, auditLog } from '@/lib/db'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const view = searchParams.get('view') ?? 'templates'

  try {
    if (view === 'purchases') {
      // Pending purchases queue
      const pending = await sql`
        SELECT
          pp.id, pp.tenant_id, pp.proposal_id, pp.opportunity_id,
          pp.purchase_type, pp.price_cents, pp.status,
          pp.purchased_at, pp.cancellation_deadline,
          pp.template_delivered_at, pp.template_id,
          pp.delivered_by, pp.notes,
          t.name AS tenant_name, t.slug AS tenant_slug,
          p.title AS proposal_title, p.program_type AS proposal_program_type
        FROM proposal_purchases pp
        JOIN tenants t ON t.id = pp.tenant_id
        LEFT JOIN proposals p ON p.id = pp.proposal_id
        WHERE pp.status = 'pending'
        ORDER BY pp.purchased_at ASC
      `

      // Recently delivered (last 10)
      const delivered = await sql`
        SELECT
          pp.id, pp.tenant_id, pp.proposal_id, pp.opportunity_id,
          pp.purchase_type, pp.price_cents, pp.status,
          pp.purchased_at, pp.cancellation_deadline,
          pp.template_delivered_at, pp.template_id,
          pp.delivered_by, pp.notes,
          t.name AS tenant_name, t.slug AS tenant_slug,
          p.title AS proposal_title, p.program_type AS proposal_program_type,
          mt.template_name
        FROM proposal_purchases pp
        JOIN tenants t ON t.id = pp.tenant_id
        LEFT JOIN proposals p ON p.id = pp.proposal_id
        LEFT JOIN master_templates mt ON mt.id = pp.template_id
        WHERE pp.status = 'template_delivered'
        ORDER BY pp.template_delivered_at DESC
        LIMIT 10
      `

      return NextResponse.json({ data: { pending, delivered } })
    }

    // Default: list all templates
    const templates = await sql`
      SELECT
        id, agency, component, program_type, template_name,
        description, sections, page_limits, eval_criteria,
        submission_format, version, is_current, solicitation_pattern,
        notes, created_by, created_at, updated_at
      FROM master_templates
      ORDER BY agency, program_type, version DESC
    `
    return NextResponse.json({ data: templates })
  } catch (error) {
    console.error('[GET /api/admin/templates] Error:', error)
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const {
    agency,
    component,
    programType,
    templateName,
    description,
    sections,
    pageLimits,
    evalCriteria,
    submissionFormat,
    solicitationPattern,
    notes,
  } = body as {
    agency?: string
    component?: string
    programType?: string
    templateName?: string
    description?: string
    sections?: unknown[]
    pageLimits?: unknown
    evalCriteria?: unknown
    submissionFormat?: unknown
    solicitationPattern?: string
    notes?: string
  }

  if (!agency || !templateName) {
    return NextResponse.json({ error: 'agency and templateName are required' }, { status: 400 })
  }

  if (!programType) {
    return NextResponse.json({ error: 'programType is required' }, { status: 400 })
  }

  if (sections && !Array.isArray(sections)) {
    return NextResponse.json({ error: 'sections must be an array' }, { status: 400 })
  }

  try {
    // Check if a template with this name already exists to determine version
    const existing = await sql`
      SELECT version FROM master_templates
      WHERE template_name = ${templateName}
      ORDER BY version DESC
      LIMIT 1
    `

    const nextVersion = existing.length > 0 ? (existing[0].version as number) + 1 : 1

    // If there are existing templates with this name, mark them as not current
    if (existing.length > 0) {
      await sql`
        UPDATE master_templates
        SET is_current = false, updated_at = NOW()
        WHERE template_name = ${templateName}
      `
    }

    const [template] = await sql`
      INSERT INTO master_templates (
        agency, component, program_type, template_name, description,
        sections, page_limits, eval_criteria, submission_format,
        version, is_current, solicitation_pattern, notes, created_by
      ) VALUES (
        ${agency},
        ${component ?? null},
        ${programType},
        ${templateName},
        ${description ?? null},
        ${JSON.stringify(sections ?? [])}::jsonb,
        ${pageLimits ? JSON.stringify(pageLimits) : null}::jsonb,
        ${evalCriteria ? JSON.stringify(evalCriteria) : null}::jsonb,
        ${submissionFormat ? JSON.stringify(submissionFormat) : null}::jsonb,
        ${nextVersion},
        true,
        ${solicitationPattern ?? null},
        ${notes ?? null},
        ${session.user.id}
      )
      RETURNING *
    `

    // Audit log for template creation (admin action, no tenant)
    await auditLog({
      userId: session.user.id,
      action: 'template.created',
      entityType: 'master_template',
      entityId: template.id as string,
      newValue: { agency, templateName, programType, version: nextVersion },
    })

    return NextResponse.json({ data: template }, { status: 201 })
  } catch (error: unknown) {
    // Handle unique constraint violation
    if (typeof error === 'object' && error !== null && 'code' in error && (error as { code: string }).code === '23505') {
      return NextResponse.json({ error: 'A template with this name and version already exists' }, { status: 409 })
    }
    console.error('[POST /api/admin/templates] Error:', error)
    return NextResponse.json({ error: 'Failed to create template' }, { status: 500 })
  }
}
