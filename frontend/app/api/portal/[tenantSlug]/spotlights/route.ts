/**
 * GET  /api/portal/[tenantSlug]/spotlights — List SpotLight buckets
 * POST /api/portal/[tenantSlug]/spotlights — Create a new SpotLight bucket
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string }> }

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
  const result = await resolveTenant(session, tenantSlug, 'GET /api/portal/spotlights')
  if (result.error) return result.error
  const tenant = result.tenant

  try {
    const spotlights = await sql`
      SELECT
        fa.id, fa.tenant_id, fa.name, fa.description,
        fa.naics_codes, fa.keywords, fa.set_aside_types,
        fa.agency_priorities, fa.keyword_domains,
        fa.is_small_business,
        fa.min_contract_value, fa.max_contract_value,
        fa.min_score_threshold, fa.opportunity_types,
        fa.company_summary, fa.technology_focus,
        fa.status, fa.sort_order, fa.created_by,
        fa.last_scored_at, fa.matched_opp_count,
        fa.created_at, fa.updated_at,
        (SELECT COUNT(*) FROM spotlight_scores ss
         WHERE ss.spotlight_id = fa.id AND ss.total_score >= fa.min_score_threshold) AS above_threshold_count,
        (SELECT COUNT(*) FROM spotlight_scores ss
         WHERE ss.spotlight_id = fa.id AND ss.total_score >= 75) AS high_priority_count,
        (SELECT COUNT(*) FROM tenant_uploads tu
         WHERE tu.spotlight_id = fa.id AND tu.is_active = TRUE) AS upload_count
      FROM focus_areas fa
      WHERE fa.tenant_id = ${tenant.id}
      ORDER BY fa.sort_order, fa.created_at
    `

    return NextResponse.json({ data: spotlights })
  } catch (error) {
    console.error('[GET /api/portal/spotlights] Error:', error)
    return NextResponse.json({ error: 'Failed to load spotlights' }, { status: 500 })
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params
  const result = await resolveTenant(session, tenantSlug, 'POST /api/portal/spotlights')
  if (result.error) return result.error
  const tenant = result.tenant

  // Only tenant_admin or master_admin can create spotlights
  if (!['tenant_admin', 'master_admin'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Only admins can create SpotLight buckets' }, { status: 403 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { name, description, naicsCodes, keywords, setAsideTypes, agencyPriorities,
          keywordDomains, isSmallBusiness, minContractValue, maxContractValue,
          minScoreThreshold, opportunityTypes, companySummary, technologyFocus } = body

  if (!name?.trim()) {
    return NextResponse.json({ error: 'SpotLight name is required' }, { status: 400 })
  }

  // Check bucket limit
  try {
    const [counts] = await sql`
      SELECT
        (SELECT COUNT(*) FROM focus_areas WHERE tenant_id = ${tenant.id} AND status = 'active') AS current_count,
        t.max_spotlights
      FROM tenants t WHERE t.id = ${tenant.id}
    `
    if (Number(counts.current_count) >= Number(counts.max_spotlights)) {
      return NextResponse.json({
        error: `SpotLight limit reached (${counts.max_spotlights}). Upgrade your plan for more.`
      }, { status: 429 })
    }
  } catch (error) {
    console.error('[POST /api/portal/spotlights] Limit check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  try {
    const [spotlight] = await sql`
      INSERT INTO focus_areas (
        tenant_id, name, description, naics_codes, keywords,
        set_aside_types, agency_priorities, keyword_domains,
        is_small_business, min_contract_value, max_contract_value,
        min_score_threshold, opportunity_types, company_summary,
        technology_focus, created_by, status
      ) VALUES (
        ${tenant.id}, ${name.trim()}, ${description ?? null},
        ${naicsCodes ?? []}, ${keywords ?? []},
        ${setAsideTypes ?? []}, ${JSON.stringify(agencyPriorities ?? {})},
        ${JSON.stringify(keywordDomains ?? {})},
        ${isSmallBusiness ?? true}, ${minContractValue ?? null}, ${maxContractValue ?? null},
        ${minScoreThreshold ?? 40}, ${opportunityTypes ?? []},
        ${companySummary ?? null}, ${technologyFocus ?? null},
        ${session.user.id}, 'active'
      )
      RETURNING *
    `

    try {
      await emitCustomerEvent({
        tenantId: tenant.id,
        eventType: 'spotlight.created',
        userId: session.user.id,
        entityType: 'spotlight',
        entityId: spotlight.id,
        description: `SpotLight bucket created: ${name.trim()}`,
        actor: userActor(session.user.id, session.user.email ?? undefined),
        refs: { tenant_id: tenant.id },
        payload: { name: name.trim(), naics_codes: naicsCodes, keywords },
      })
    } catch (e) {
      console.error('[POST /api/portal/spotlights] Event emit error (non-critical):', e)
    }

    return NextResponse.json({ data: spotlight }, { status: 201 })
  } catch (error: any) {
    console.error('[POST /api/portal/spotlights] Error:', error)
    if (error?.code === '23505') {
      return NextResponse.json({ error: 'A SpotLight with that name already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create SpotLight' }, { status: 500 })
  }
}
