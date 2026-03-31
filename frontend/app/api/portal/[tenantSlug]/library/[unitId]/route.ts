/**
 * GET    /api/portal/[tenantSlug]/library/[unitId] — Single library unit detail + related proposals
 * PATCH  /api/portal/[tenantSlug]/library/[unitId] — Update library unit (admin only)
 * DELETE /api/portal/[tenantSlug]/library/[unitId] — Soft-delete (archive) library unit (admin only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string; unitId: string }> }

async function resolveContext(session: any, slug: string, unitId: string, routeTag: string) {
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

  let unit: any
  try {
    const [row] = await sql`
      SELECT * FROM library_units WHERE id = ${unitId} AND tenant_id = ${tenant.id}
    `
    unit = row
  } catch (error) {
    console.error(`[${routeTag}] Unit fetch error:`, error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!unit) return { error: NextResponse.json({ error: 'Unit not found' }, { status: 404 }) }

  return { tenant, unit }
}

// ── GET — Full unit detail with related proposals and source upload ──

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug, unitId } = await params
  const ctx = await resolveContext(session, tenantSlug, unitId, 'GET /api/portal/library/[unitId]')
  if (ctx.error) return ctx.error

  const { unit } = ctx

  try {
    const [proposalUsages, sourceUploadRows] = await Promise.all([
      sql`
        SELECT
          psu.proposal_id,
          psu.section_id,
          psu.created_at AS linked_at,
          p.title AS proposal_title,
          p.stage AS proposal_stage,
          p.status AS proposal_status,
          ps.title AS section_title
        FROM proposal_section_units psu
        JOIN proposals p ON psu.proposal_id = p.id
        LEFT JOIN proposal_sections ps ON psu.section_id = ps.id
        WHERE psu.unit_id = ${unitId}
        ORDER BY psu.created_at DESC
      `,
      unit.source_upload_id
        ? sql`
            SELECT id, file_name, file_type, file_size_bytes, status, created_at
            FROM uploads
            WHERE id = ${unit.source_upload_id}
          `
        : Promise.resolve([]),
    ])

    return NextResponse.json({
      data: {
        ...unit,
        proposalUsages,
        sourceUpload: sourceUploadRows[0] ?? null,
      },
    })
  } catch (error) {
    console.error('[GET /api/portal/library/[unitId]] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

// ── PATCH — Update library unit (admin only) ──

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (session.user.role !== 'tenant_admin' && session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Only admins can update library units' }, { status: 403 })
  }

  const { tenantSlug, unitId } = await params
  const ctx = await resolveContext(session, tenantSlug, unitId, 'PATCH /api/portal/library/[unitId]')
  if (ctx.error) return ctx.error

  const { tenant, unit } = ctx

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { content, category, subcategory, tags, status, confidenceScore } = body

  try {
    const previousStatus = unit.status

    const [updated] = await sql`
      UPDATE library_units
      SET
        content = COALESCE(${content ?? null}, content),
        category = COALESCE(${category ?? null}, category),
        subcategory = COALESCE(${subcategory ?? null}, subcategory),
        tags = COALESCE(${tags ?? null}, tags),
        status = COALESCE(${status ?? null}, status),
        confidence_score = COALESCE(${confidenceScore ?? null}, confidence_score),
        updated_at = NOW()
      WHERE id = ${unitId} AND tenant_id = ${tenant.id}
      RETURNING *
    `

    if (!updated) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
    }

    // Emit event based on status change
    if (status && status !== previousStatus && status === 'approved') {
      emitCustomerEvent({
        tenantId: tenant.id,
        eventType: 'library.atom_approved',
        userId: session.user.id,
        entityType: 'library_unit',
        entityId: unitId,
        description: `Library unit approved`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        payload: { unitId, previousStatus, newStatus: status },
      }).catch(e => console.error('[PATCH /api/portal/library/[unitId]] Event emission error (non-critical):', e))
    } else if (status && status !== previousStatus) {
      emitCustomerEvent({
        tenantId: tenant.id,
        eventType: 'library.atom_updated',
        userId: session.user.id,
        entityType: 'library_unit',
        entityId: unitId,
        description: `Library unit status changed from ${previousStatus} to ${status}`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        payload: { unitId, previousStatus, newStatus: status },
      }).catch(e => console.error('[PATCH /api/portal/library/[unitId]] Event emission error (non-critical):', e))
    } else if (content || category || subcategory || tags || confidenceScore !== undefined) {
      emitCustomerEvent({
        tenantId: tenant.id,
        eventType: 'library.atom_updated',
        userId: session.user.id,
        entityType: 'library_unit',
        entityId: unitId,
        description: `Library unit updated`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        payload: { unitId, fieldsUpdated: Object.keys(body) },
      }).catch(e => console.error('[PATCH /api/portal/library/[unitId]] Event emission error (non-critical):', e))
    }

    return NextResponse.json({ data: updated })
  } catch (error) {
    console.error('[PATCH /api/portal/library/[unitId]] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

// ── DELETE — Soft-delete (archive) library unit (admin only) ──

export async function DELETE(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (session.user.role !== 'tenant_admin' && session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Only admins can archive library units' }, { status: 403 })
  }

  const { tenantSlug, unitId } = await params
  const ctx = await resolveContext(session, tenantSlug, unitId, 'DELETE /api/portal/library/[unitId]')
  if (ctx.error) return ctx.error

  const { tenant } = ctx

  try {
    const [archived] = await sql`
      UPDATE library_units
      SET status = 'archived', updated_at = NOW()
      WHERE id = ${unitId} AND tenant_id = ${tenant.id}
      RETURNING id, content_type, category
    `

    if (!archived) {
      return NextResponse.json({ error: 'Unit not found' }, { status: 404 })
    }

    emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'library.atom_archived',
      userId: session.user.id,
      entityType: 'library_unit',
      entityId: unitId,
      description: `Library unit archived`,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      payload: { unitId, category: archived.category },
    }).catch(e => console.error('[DELETE /api/portal/library/[unitId]] Event emission error (non-critical):', e))

    return NextResponse.json({ data: archived, message: 'Library unit archived' })
  } catch (error) {
    console.error('[DELETE /api/portal/library/[unitId]] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
