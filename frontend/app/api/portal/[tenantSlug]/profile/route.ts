/**
 * GET /api/portal/[tenantSlug]/profile — Read tenant profile
 * PATCH /api/portal/[tenantSlug]/profile — Update search parameters
 *
 * Portal-accessible tenant profile endpoint.
 * Accessible to tenant_user, tenant_admin, and master_admin.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import { emitCustomerEvent, userActor } from '@/lib/events'

type Params = { params: Promise<{ tenantSlug: string }> }

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[GET /api/portal/profile] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[GET /api/portal/profile] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const [profile] = await sql`
      SELECT * FROM tenant_profiles WHERE tenant_id = ${tenant.id}
    `

    return NextResponse.json({
      tenant: {
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        status: tenant.status,
      },
      profile: profile ?? null,
      userRole: session.user.role,
    })
  } catch (error) {
    console.error('[GET /api/portal/profile] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}

/**
 * PATCH /api/portal/[tenantSlug]/profile — Update tenant search parameters
 *
 * Body fields (all optional):
 *   primaryNaics, secondaryNaics, keywordDomains, agencyPriorities,
 *   isSmallBusiness, isSdvosb, isWosb, isHubzone, is8a,
 *   minContractValue, maxContractValue, minSurfaceScore, highPriorityScore
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only tenant_admin and master_admin can update profiles
  if (!['tenant_admin', 'master_admin'].includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { tenantSlug } = await params

  let tenant: any
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error('[PATCH /api/portal/profile] Tenant resolution error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error('[PATCH /api/portal/profile] Access check error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Map camelCase body keys to snake_case DB columns
  const fieldMap: Record<string, string> = {
    primaryNaics: 'primary_naics',
    secondaryNaics: 'secondary_naics',
    keywordDomains: 'keyword_domains',
    agencyPriorities: 'agency_priorities',
    isSmallBusiness: 'is_small_business',
    isSdvosb: 'is_sdvosb',
    isWosb: 'is_wosb',
    isHubzone: 'is_hubzone',
    is8a: 'is_8a',
    minContractValue: 'min_contract_value',
    maxContractValue: 'max_contract_value',
    minSurfaceScore: 'min_surface_score',
    highPriorityScore: 'high_priority_score',
  }

  const fieldsChanged: string[] = []
  for (const key of Object.keys(body)) {
    if (fieldMap[key]) fieldsChanged.push(fieldMap[key])
  }

  if (fieldsChanged.length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
  }

  try {
    // Upsert the profile
    await sql`
      INSERT INTO tenant_profiles (tenant_id, updated_by, updated_at,
        primary_naics, secondary_naics, keyword_domains, agency_priorities,
        is_small_business, is_sdvosb, is_wosb, is_hubzone, is_8a,
        min_contract_value, max_contract_value, min_surface_score, high_priority_score
      ) VALUES (
        ${tenant.id}, ${session.user.email ?? 'admin'}, NOW(),
        ${(body.primaryNaics as string[]) ?? null},
        ${(body.secondaryNaics as string[]) ?? null},
        ${body.keywordDomains ? JSON.stringify(body.keywordDomains) : null}::jsonb,
        ${body.agencyPriorities ? JSON.stringify(body.agencyPriorities) : null}::jsonb,
        ${(body.isSmallBusiness as boolean) ?? null},
        ${(body.isSdvosb as boolean) ?? null},
        ${(body.isWosb as boolean) ?? null},
        ${(body.isHubzone as boolean) ?? null},
        ${(body.is8a as boolean) ?? null},
        ${(body.minContractValue as number) ?? null},
        ${(body.maxContractValue as number) ?? null},
        ${(body.minSurfaceScore as number) ?? null},
        ${(body.highPriorityScore as number) ?? null}
      )
      ON CONFLICT (tenant_id) DO UPDATE SET
        primary_naics = COALESCE(${(body.primaryNaics as string[]) ?? null}, tenant_profiles.primary_naics),
        secondary_naics = COALESCE(${(body.secondaryNaics as string[]) ?? null}, tenant_profiles.secondary_naics),
        keyword_domains = COALESCE(${body.keywordDomains ? JSON.stringify(body.keywordDomains) : null}::jsonb, tenant_profiles.keyword_domains),
        agency_priorities = COALESCE(${body.agencyPriorities ? JSON.stringify(body.agencyPriorities) : null}::jsonb, tenant_profiles.agency_priorities),
        is_small_business = COALESCE(${(body.isSmallBusiness as boolean) ?? null}, tenant_profiles.is_small_business),
        is_sdvosb = COALESCE(${(body.isSdvosb as boolean) ?? null}, tenant_profiles.is_sdvosb),
        is_wosb = COALESCE(${(body.isWosb as boolean) ?? null}, tenant_profiles.is_wosb),
        is_hubzone = COALESCE(${(body.isHubzone as boolean) ?? null}, tenant_profiles.is_hubzone),
        is_8a = COALESCE(${(body.is8a as boolean) ?? null}, tenant_profiles.is_8a),
        min_contract_value = COALESCE(${(body.minContractValue as number) ?? null}, tenant_profiles.min_contract_value),
        max_contract_value = COALESCE(${(body.maxContractValue as number) ?? null}, tenant_profiles.max_contract_value),
        min_surface_score = COALESCE(${(body.minSurfaceScore as number) ?? null}, tenant_profiles.min_surface_score),
        high_priority_score = COALESCE(${(body.highPriorityScore as number) ?? null}, tenant_profiles.high_priority_score),
        updated_by = ${session.user.email ?? 'admin'},
        updated_at = NOW()
    `

    // Emit profile updated event — triggers automation (e.g., re-scoring)
    await emitCustomerEvent({
      tenantId: tenant.id,
      eventType: 'account.profile_updated',
      userId: session.user.id,
      entityType: 'tenant_profile',
      entityId: tenant.id,
      description: `Profile updated: ${fieldsChanged.join(', ')}`,
      actor: userActor(session.user.id, session.user.email ?? undefined),
      refs: { tenant_id: tenant.id, tenant_slug: tenantSlug },
      payload: {
        fields_changed: fieldsChanged,
        tenant_name: tenant.name,
      },
    })

    // Read back the updated profile
    const [profile] = await sql`
      SELECT * FROM tenant_profiles WHERE tenant_id = ${tenant.id}
    `

    return NextResponse.json({ data: profile })
  } catch (error) {
    console.error('[PATCH /api/portal/profile] Error:', error)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}
