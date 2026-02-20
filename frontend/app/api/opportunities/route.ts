/**
 * GET /api/opportunities?tenantSlug=acme-tech&...filters
 * Returns tenant_pipeline VIEW rows — opportunities scored for this tenant
 *
 * POST /api/opportunities/[opportunityId]/action
 * Record a tenant action (thumbs, comment, status change)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'
import type { OpportunityFilters, TenantPipelineItem, PaginatedResponse } from '@/types'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const tenantSlug = searchParams.get('tenantSlug')

  if (!tenantSlug) return NextResponse.json({ error: 'tenantSlug required' }, { status: 400 })

  // Resolve slug → tenant
  const tenant = await getTenantBySlug(tenantSlug)
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // Verify access
  const hasAccess = await verifyTenantAccess(session.user.id!, session.user.role, tenant.id)
  if (!hasAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Parse filters
  const filters: OpportunityFilters = {
    search:          searchParams.get('search') ?? undefined,
    source:          searchParams.get('source') ?? undefined,
    opportunityType: searchParams.get('opportunityType') ?? undefined,
    minScore:        Number(searchParams.get('minScore') ?? 0) || undefined,
    agency:          searchParams.get('agency') ?? undefined,
    pursuitStatus:   searchParams.get('pursuitStatus') as any ?? undefined,
    deadlineStatus:  searchParams.get('deadlineStatus') as any ?? undefined,
    isPinned:        searchParams.get('isPinned') === 'true' ? true : undefined,
    sortBy:          (searchParams.get('sortBy') ?? 'score') as any,
    sortDir:         (searchParams.get('sortDir') ?? 'desc') as any,
    limit:           Math.max(1, Math.min(Number(searchParams.get('limit') ?? 50) || 50, 100)),
    offset:          Math.max(0, Number(searchParams.get('offset') ?? 0) || 0),
  }

  const orderMap: Record<string, string> = {
    score:       'total_score',
    close_date:  'close_date',
    posted_date: 'posted_date',
    last_action: 'last_action_at',
  }
  const orderCol = orderMap[filters.sortBy ?? 'score'] ?? 'total_score'

  try {
    const [rows, [{ count }]] = await Promise.all([
      sql<TenantPipelineItem[]>`
        SELECT *
        FROM tenant_pipeline
        WHERE tenant_id = ${tenant.id}
          AND (${filters.minScore ?? 0} = 0 OR total_score >= ${filters.minScore ?? 0})
          AND (${filters.source        ?? ''} = '' OR source          = ${filters.source        ?? ''})
          AND (${filters.opportunityType ?? ''} = '' OR opportunity_type = ${filters.opportunityType ?? ''})
          AND (${filters.agency        ?? ''} = '' OR agency_code     = ${filters.agency        ?? ''})
          AND (${filters.pursuitStatus ?? ''} = '' OR pursuit_status  = ${filters.pursuitStatus ?? ''})
          AND (${filters.deadlineStatus ?? ''} = '' OR deadline_status = ${filters.deadlineStatus ?? ''})
          AND (${filters.isPinned ?? false} = false OR is_pinned = true)
          AND (
            ${filters.search ?? ''} = ''
            OR title ILIKE ${'%' + (filters.search ?? '') + '%'}
            OR solicitation_number ILIKE ${'%' + (filters.search ?? '') + '%'}
            OR agency ILIKE ${'%' + (filters.search ?? '') + '%'}
          )
        ORDER BY ${sql(orderCol)} ${filters.sortDir === 'asc' ? sql`ASC` : sql`DESC NULLS LAST`}
        LIMIT ${filters.limit ?? 50}
        OFFSET ${filters.offset ?? 0}
      `,
      sql<[{ count: string }]>`
        SELECT COUNT(*) FROM tenant_pipeline
        WHERE tenant_id = ${tenant.id}
          AND (${filters.minScore ?? 0} = 0 OR total_score >= ${filters.minScore ?? 0})
      `,
    ])

    const response: PaginatedResponse<TenantPipelineItem> = {
      data: rows as unknown as TenantPipelineItem[],
      total: Number(count),
      limit: filters.limit ?? 50,
      offset: filters.offset ?? 0,
    }
    return NextResponse.json(response)

  } catch (error) {
    console.error('[/api/opportunities] Error:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
}
