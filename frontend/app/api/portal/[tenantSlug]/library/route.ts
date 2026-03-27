/**
 * GET  /api/portal/[tenantSlug]/library — List library units with filtering, search, pagination
 * POST /api/portal/[tenantSlug]/library — Create a library unit manually (admin only)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string }> }

const VALID_CATEGORIES = new Set([
  'bio', 'tech_approach', 'past_performance', 'management_approach',
  'corporate_overview', 'staffing', 'quality_control', 'transition_plan',
])
const VALID_STATUSES = new Set(['draft', 'approved', 'archived', 'rejected'])
const VALID_SORT_FIELDS = new Set(['created_at', 'confidence_score', 'category'])
const MAX_LIMIT = 100
const DEFAULT_LIMIT = 20

async function resolveTenant(session: any, slug: string, routeTag: string) {
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

  return { tenant }
}

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params
  const result = await resolveTenant(session, tenantSlug, 'GET /api/portal/library')
  if (result.error) return result.error
  const tenant = result.tenant

  // Parse query params
  const searchParams = request.nextUrl.searchParams
  const category = searchParams.get('category')
  const status = searchParams.get('status')
  const search = searchParams.get('search')
  const sort = searchParams.get('sort') ?? 'created_at'
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT))
  const offset = (page - 1) * limit

  // Validate filter values
  if (category && !VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: `Invalid category. Valid values: ${[...VALID_CATEGORIES].join(', ')}` }, { status: 400 })
  }
  if (status && !VALID_STATUSES.has(status)) {
    return NextResponse.json({ error: `Invalid status. Valid values: ${[...VALID_STATUSES].join(', ')}` }, { status: 400 })
  }
  if (!VALID_SORT_FIELDS.has(sort)) {
    return NextResponse.json({ error: `Invalid sort. Valid values: ${[...VALID_SORT_FIELDS].join(', ')}` }, { status: 400 })
  }

  try {
    // Build WHERE conditions dynamically
    const conditions = [sql`lu.tenant_id = ${tenant.id}`]

    if (category) {
      conditions.push(sql`lu.category = ${category}`)
    }
    if (status) {
      conditions.push(sql`lu.status = ${status}`)
    } else {
      // Default: exclude archived
      conditions.push(sql`lu.status != 'archived'`)
    }
    if (search) {
      conditions.push(sql`lu.content ILIKE ${'%' + search + '%'}`)
    }

    const whereClause = conditions.reduce((acc, cond, i) =>
      i === 0 ? cond : sql`${acc} AND ${cond}`
    )

    // Get total count
    const [countRow] = await sql`
      SELECT COUNT(*)::int AS total
      FROM library_units lu
      WHERE ${whereClause}
    `
    const total = countRow?.total ?? 0

    // Get paginated results with sort
    let units
    if (sort === 'confidence_score') {
      units = await sql`
        SELECT lu.id, lu.content, lu.content_type, lu.category, lu.subcategory,
               lu.tags, lu.confidence_score, lu.status, lu.source_upload_id,
               lu.origin_type, lu.created_at, lu.updated_at,
               (lu.embedding IS NOT NULL) AS has_embedding,
               tu.original_filename AS source_filename
        FROM library_units lu
        LEFT JOIN tenant_uploads tu ON lu.source_upload_id = tu.id
        WHERE ${whereClause}
        ORDER BY lu.confidence_score DESC NULLS LAST
        LIMIT ${limit} OFFSET ${offset}
      `
    } else if (sort === 'category') {
      units = await sql`
        SELECT lu.id, lu.content, lu.content_type, lu.category, lu.subcategory,
               lu.tags, lu.confidence_score, lu.status, lu.source_upload_id,
               lu.origin_type, lu.created_at, lu.updated_at,
               (lu.embedding IS NOT NULL) AS has_embedding,
               tu.original_filename AS source_filename
        FROM library_units lu
        LEFT JOIN tenant_uploads tu ON lu.source_upload_id = tu.id
        WHERE ${whereClause}
        ORDER BY lu.category ASC, lu.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    } else {
      // Default: created_at desc
      units = await sql`
        SELECT lu.id, lu.content, lu.content_type, lu.category, lu.subcategory,
               lu.tags, lu.confidence_score, lu.status, lu.source_upload_id,
               lu.origin_type, lu.created_at, lu.updated_at,
               (lu.embedding IS NOT NULL) AS has_embedding,
               tu.original_filename AS source_filename
        FROM library_units lu
        LEFT JOIN tenant_uploads tu ON lu.source_upload_id = tu.id
        WHERE ${whereClause}
        ORDER BY lu.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `
    }

    // Map to camelCase response shape (postgres.js transform handles column names,
    // but we alias has_embedding and source_filename explicitly)
    const data = units.map((u: any) => ({
      id: u.id,
      content: u.content,
      contentType: u.contentType,
      category: u.category,
      subcategory: u.subcategory,
      tags: u.tags ?? [],
      confidenceScore: u.confidenceScore != null ? Number(u.confidenceScore) : null,
      status: u.status,
      sourceUploadId: u.sourceUploadId,
      originType: u.originType,
      hasEmbedding: u.hasEmbedding ?? false,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      sourceFilename: u.sourceFilename ?? null,
    }))

    return NextResponse.json({ data, total, page, limit })
  } catch (error) {
    console.error('[GET /api/portal/library] Error:', error)
    return NextResponse.json({ error: 'Failed to load library units' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only tenant_admin or master_admin can create library units
  if (!['tenant_admin', 'master_admin'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden: admin access required' }, { status: 403 })
  }

  const { tenantSlug } = await params
  const result = await resolveTenant(session, tenantSlug, 'POST /api/portal/library')
  if (result.error) return result.error
  const tenant = result.tenant

  // Parse request body
  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  // Validate required fields
  const { content, category, subcategory, tags, status: unitStatus } = body ?? {}

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return NextResponse.json({ error: 'content is required and must be a non-empty string' }, { status: 400 })
  }
  if (!category || typeof category !== 'string') {
    return NextResponse.json({ error: 'category is required' }, { status: 400 })
  }
  if (!VALID_CATEGORIES.has(category)) {
    return NextResponse.json({ error: `Invalid category. Valid values: ${[...VALID_CATEGORIES].join(', ')}` }, { status: 400 })
  }
  if (unitStatus && !VALID_STATUSES.has(unitStatus)) {
    return NextResponse.json({ error: `Invalid status. Valid values: ${[...VALID_STATUSES].join(', ')}` }, { status: 400 })
  }
  if (tags && !Array.isArray(tags)) {
    return NextResponse.json({ error: 'tags must be an array of strings' }, { status: 400 })
  }

  const resolvedStatus = unitStatus ?? 'draft'
  const resolvedTags = Array.isArray(tags) ? tags.filter((t: unknown) => typeof t === 'string') : []

  try {
    const [unit] = await sql`
      INSERT INTO library_units (
        tenant_id, content, content_type, category, subcategory,
        tags, status, origin_type
      ) VALUES (
        ${tenant.id}, ${content.trim()}, ${'text'}, ${category},
        ${subcategory ?? null}, ${resolvedTags}, ${resolvedStatus},
        ${'manual_entry'}
      )
      RETURNING id, content, content_type, category, subcategory,
                tags, confidence_score, status, source_upload_id,
                origin_type, created_at, updated_at
    `

    // Emit event (non-critical)
    try {
      const eventType = resolvedStatus === 'approved'
        ? 'library.atom_approved' as const
        : 'library.atoms_extracted' as const

      await emitCustomerEvent({
        tenantId: tenant.id,
        eventType,
        userId: session.user.id,
        entityType: 'library_unit',
        entityId: unit.id,
        description: `Library unit created manually (${category}, status: ${resolvedStatus})`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        refs: { tenant_id: tenant.id },
        payload: {
          category,
          subcategory: subcategory ?? null,
          status: resolvedStatus,
          origin_type: 'manual_entry',
        },
      })
    } catch (e) {
      console.error('[POST /api/portal/library] Event emit error (non-critical):', e)
    }

    const data = {
      id: unit.id,
      content: unit.content,
      contentType: unit.contentType,
      category: unit.category,
      subcategory: unit.subcategory,
      tags: unit.tags ?? [],
      confidenceScore: unit.confidenceScore != null ? Number(unit.confidenceScore) : null,
      status: unit.status,
      sourceUploadId: unit.sourceUploadId ?? null,
      originType: unit.originType,
      hasEmbedding: false,
      createdAt: unit.createdAt,
      updatedAt: unit.updatedAt,
      sourceFilename: null,
    }

    return NextResponse.json({ data }, { status: 201 })
  } catch (error: any) {
    // Handle unique constraint violations
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'A library unit with this content already exists' }, { status: 409 })
    }
    console.error('[POST /api/portal/library] Error:', error)
    return NextResponse.json({ error: 'Failed to create library unit' }, { status: 500 })
  }
}
