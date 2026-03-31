/**
 * GET    /api/portal/[tenantSlug]/spotlights/[spotlightId] — Get spotlight detail + stats
 * PATCH  /api/portal/[tenantSlug]/spotlights/[spotlightId] — Update spotlight config
 * DELETE /api/portal/[tenantSlug]/spotlights/[spotlightId] — Deactivate spotlight
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string; spotlightId: string }> }

async function resolveTenantAndSpotlight(session: any, slug: string, spotlightId: string, routeTag: string) {
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

  let spotlight: any
  try {
    const [row] = await sql`
      SELECT * FROM focus_areas WHERE id = ${spotlightId} AND tenant_id = ${tenant.id}
    `
    spotlight = row
  } catch (error) {
    console.error(`[${routeTag}] Spotlight fetch error:`, error)
    return { error: NextResponse.json({ error: 'Database error' }, { status: 500 }) }
  }
  if (!spotlight) return { error: NextResponse.json({ error: 'SpotLight not found' }, { status: 404 }) }

  return { tenant, spotlight }
}

export async function GET(_request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug, spotlightId } = await params
  const result = await resolveTenantAndSpotlight(session, tenantSlug, spotlightId, 'GET /api/portal/spotlights/[id]')
  if (result.error) return result.error
  const { spotlight, tenant } = result

  try {
    // Get stats
    const [stats] = await sql`
      SELECT
        (SELECT COUNT(*) FROM spotlight_scores ss
         WHERE ss.spotlight_id = ${spotlightId} AND ss.total_score >= ${spotlight.min_score_threshold}) AS above_threshold,
        (SELECT COUNT(*) FROM spotlight_scores ss
         WHERE ss.spotlight_id = ${spotlightId} AND ss.total_score >= 75) AS high_priority,
        (SELECT COUNT(*) FROM spotlight_scores ss
         WHERE ss.spotlight_id = ${spotlightId}) AS total_scored,
        (SELECT MAX(ss.total_score) FROM spotlight_scores ss
         WHERE ss.spotlight_id = ${spotlightId}) AS top_score,
        (SELECT AVG(ss.total_score) FROM spotlight_scores ss
         WHERE ss.spotlight_id = ${spotlightId} AND ss.total_score >= ${spotlight.min_score_threshold}) AS avg_score,
        (SELECT COUNT(*) FROM tenant_uploads tu
         WHERE tu.spotlight_id = ${spotlightId} AND tu.is_active = TRUE) AS upload_count
    `

    // Get top scored opportunities for this spotlight
    const topOpps = await sql`
      SELECT
        ss.total_score, ss.naics_score, ss.keyword_score,
        ss.set_aside_score, ss.agency_score, ss.llm_rationale,
        ss.matched_keywords, ss.scored_at,
        o.id AS opp_id, o.title, o.agency, o.solicitation_number,
        o.close_date, o.set_aside_type, o.opportunity_type
      FROM spotlight_scores ss
      JOIN opportunities o ON ss.opportunity_id = o.id
      WHERE ss.spotlight_id = ${spotlightId}
        AND ss.total_score >= ${spotlight.min_score_threshold}
      ORDER BY ss.total_score DESC
      LIMIT 50
    `

    // Get uploads linked to this spotlight
    const uploads = await sql`
      SELECT tu.id, tu.original_filename, tu.file_size_bytes, tu.mime_type,
             tu.upload_category, tu.description, tu.library_status,
             tu.atom_count, tu.created_at,
             u.name AS uploaded_by_name
      FROM tenant_uploads tu
      LEFT JOIN users u ON tu.uploaded_by = u.id
      WHERE tu.spotlight_id = ${spotlightId}
        AND tu.is_active = TRUE
      ORDER BY tu.created_at DESC
    `

    return NextResponse.json({
      data: {
        spotlight,
        stats: {
          aboveThreshold: Number(stats.above_threshold),
          highPriority: Number(stats.high_priority),
          totalScored: Number(stats.total_scored),
          topScore: stats.top_score ? Number(stats.top_score) : null,
          avgScore: stats.avg_score ? Number(stats.avg_score) : null,
          uploadCount: Number(stats.upload_count),
        },
        opportunities: topOpps,
        uploads,
      },
    })
  } catch (error) {
    console.error('[GET /api/portal/spotlights/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to load spotlight detail' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!['tenant_admin', 'master_admin'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Only admins can update SpotLights' }, { status: 403 })
  }

  const { tenantSlug, spotlightId } = await params
  const result = await resolveTenantAndSpotlight(session, tenantSlug, spotlightId, 'PATCH /api/portal/spotlights/[id]')
  if (result.error) return result.error
  const { tenant } = result

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, description, naicsCodes, keywords, setAsideTypes, agencyPriorities,
          keywordDomains, isSmallBusiness, minContractValue, maxContractValue,
          minScoreThreshold, opportunityTypes, companySummary, technologyFocus, status } = body

  try {
    const [updated] = await sql`
      UPDATE focus_areas SET
        name = COALESCE(${name ?? null}, name),
        description = COALESCE(${description ?? null}, description),
        naics_codes = COALESCE(${naicsCodes ?? null}, naics_codes),
        keywords = COALESCE(${keywords ?? null}, keywords),
        set_aside_types = COALESCE(${setAsideTypes ?? null}, set_aside_types),
        agency_priorities = COALESCE(${agencyPriorities ? JSON.stringify(agencyPriorities) : null}::jsonb, agency_priorities),
        keyword_domains = COALESCE(${keywordDomains ? JSON.stringify(keywordDomains) : null}::jsonb, keyword_domains),
        is_small_business = COALESCE(${isSmallBusiness ?? null}, is_small_business),
        min_contract_value = COALESCE(${minContractValue ?? null}, min_contract_value),
        max_contract_value = COALESCE(${maxContractValue ?? null}, max_contract_value),
        min_score_threshold = COALESCE(${minScoreThreshold ?? null}, min_score_threshold),
        opportunity_types = COALESCE(${opportunityTypes ?? null}, opportunity_types),
        company_summary = COALESCE(${companySummary ?? null}, company_summary),
        technology_focus = COALESCE(${technologyFocus ?? null}, technology_focus),
        status = COALESCE(${status ?? null}, status),
        updated_at = NOW()
      WHERE id = ${spotlightId} AND tenant_id = ${tenant.id}
      RETURNING *
    `

    try {
      await emitCustomerEvent({
        tenantId: tenant.id,
        eventType: 'spotlight.updated',
        userId: session.user.id,
        entityType: 'spotlight',
        entityId: spotlightId,
        description: `SpotLight updated: ${updated.name}`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        refs: { tenant_id: tenant.id },
        payload: body,
      })
    } catch (e) {
      console.error('[PATCH /api/portal/spotlights/[id]] Event emit error (non-critical):', e)
    }

    return NextResponse.json({ data: updated })
  } catch (error: any) {
    console.error('[PATCH /api/portal/spotlights/[id]] Error:', error)
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'A SpotLight with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to update SpotLight' }, { status: 500 })
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!['tenant_admin', 'master_admin'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Only admins can delete SpotLights' }, { status: 403 })
  }

  const { tenantSlug, spotlightId } = await params
  const result = await resolveTenantAndSpotlight(session, tenantSlug, spotlightId, 'DELETE /api/portal/spotlights/[id]')
  if (result.error) return result.error
  const { tenant, spotlight } = result

  try {
    await sql`
      UPDATE focus_areas
      SET status = 'inactive', updated_at = NOW()
      WHERE id = ${spotlightId} AND tenant_id = ${tenant.id}
    `

    try {
      await emitCustomerEvent({
        tenantId: tenant.id,
        eventType: 'spotlight.deleted',
        userId: session.user.id,
        entityType: 'spotlight',
        entityId: spotlightId,
        description: `SpotLight deactivated: ${spotlight.name}`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        refs: { tenant_id: tenant.id },
        payload: { name: spotlight.name },
      })
    } catch (e) {
      console.error('[DELETE /api/portal/spotlights/[id]] Event emit error (non-critical):', e)
    }

    return NextResponse.json({ data: { success: true } })
  } catch (error) {
    console.error('[DELETE /api/portal/spotlights/[id]] Error:', error)
    return NextResponse.json({ error: 'Failed to delete SpotLight' }, { status: 500 })
  }
}
