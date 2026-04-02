/**
 * GET    /api/admin/templates/[templateId] — Template detail with usage stats
 * PATCH  /api/admin/templates/[templateId] — Update template fields
 * DELETE /api/admin/templates/[templateId] — Archive template (soft delete)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, auditLog } from '@/lib/db'

type RouteContext = { params: Promise<{ templateId: string }> }

export async function GET(
  _request: NextRequest,
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

  try {
    const [template] = await sql`
      SELECT
        mt.*,
        COALESCE(pp.usage_count, 0) AS usage_count
      FROM master_templates mt
      LEFT JOIN (
        SELECT template_id, COUNT(*) AS usage_count
        FROM proposal_purchases
        WHERE template_id IS NOT NULL
        GROUP BY template_id
      ) pp ON pp.template_id = mt.id
      WHERE mt.id = ${templateId}
    `

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    return NextResponse.json({ data: template })
  } catch (error) {
    console.error('[GET /api/admin/templates/[templateId]] Error:', error)
    return NextResponse.json({ error: 'Failed to load template' }, { status: 500 })
  }
}

export async function PATCH(
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

  // Build dynamic update — only update provided fields
  const allowedFields: Record<string, string> = {
    agency: 'agency',
    component: 'component',
    programType: 'program_type',
    templateName: 'template_name',
    description: 'description',
    sections: 'sections',
    pageLimits: 'page_limits',
    evalCriteria: 'eval_criteria',
    submissionFormat: 'submission_format',
    solicitationPattern: 'solicitation_pattern',
    notes: 'notes',
    isCurrent: 'is_current',
  }

  const updates: string[] = []
  const values: unknown[] = []

  for (const [camelKey, snakeKey] of Object.entries(allowedFields)) {
    if (camelKey in body) {
      const val = body[camelKey]
      if (['sections', 'pageLimits', 'evalCriteria', 'submissionFormat'].includes(camelKey)) {
        updates.push(`${snakeKey} = $${values.length + 1}::jsonb`)
        values.push(val != null ? JSON.stringify(val) : null)
      } else {
        updates.push(`${snakeKey} = $${values.length + 1}`)
        values.push(val ?? null)
      }
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  try {
    // Use a raw query since we need dynamic columns
    // postgres.js unsafe() for dynamic SQL
    const setClauses = updates.join(', ')
    values.push(templateId)

    const result = await sql.unsafe(
      `UPDATE master_templates SET ${setClauses}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values as (string | number | boolean | null)[]
    )

    if (result.length === 0) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    await auditLog({
      userId: session.user.id,
      action: 'template.updated',
      entityType: 'master_template',
      entityId: templateId,
      newValue: body,
    })

    return NextResponse.json({ data: result[0] })
  } catch (error) {
    console.error('[PATCH /api/admin/templates/[templateId]] Error:', error)
    return NextResponse.json({ error: 'Failed to update template' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
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

  try {
    const result = await sql`
      UPDATE master_templates
      SET is_current = false, updated_at = NOW()
      WHERE id = ${templateId}
      RETURNING id
    `

    if (result.length === 0) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }

    await auditLog({
      userId: session.user.id,
      action: 'template.archived',
      entityType: 'master_template',
      entityId: templateId,
    })

    return NextResponse.json({ data: { archived: true } })
  } catch (error) {
    console.error('[DELETE /api/admin/templates/[templateId]] Error:', error)
    return NextResponse.json({ error: 'Failed to archive template' }, { status: 500 })
  }
}
