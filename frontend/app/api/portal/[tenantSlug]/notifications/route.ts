/**
 * GET   /api/portal/[tenantSlug]/notifications — List notifications (from customer_events)
 * PATCH /api/portal/[tenantSlug]/notifications — Mark notifications as read (acknowledge timestamp)
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'

type Params = { params: Promise<{ tenantSlug: string }> }

// ── Helpers ──────────────────────────────────────────────────

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

/**
 * Build a portal link from entity_type + entity_id.
 */
function buildLink(slug: string, entityType: string | null, entityId: string | null): string | null {
  if (!entityType) return null
  switch (entityType) {
    case 'proposal':
      return entityId ? `/portal/${slug}/proposals/${entityId}` : `/portal/${slug}/proposals`
    case 'spotlight':
      return `/portal/${slug}/spotlights`
    case 'upload':
      return `/portal/${slug}/library`
    case 'opportunity':
      return `/portal/${slug}/pipeline`
    default:
      return null
  }
}

// ── GET ──────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params
  const result = await resolveTenant(session, tenantSlug, 'GET /api/portal/notifications')
  if (result.error) return result.error
  const tenant = result.tenant

  // Parse query params
  const { searchParams } = new URL(request.url)
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 1), 100)
  const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1)
  const offset = (page - 1) * limit
  const since = searchParams.get('since')
  const typeFilter = searchParams.get('type')

  try {
    // Main query — recent customer_events for this tenant
    const events = await sql`
      SELECT id, event_type, description, entity_type, entity_id,
             metadata, created_at
      FROM customer_events
      WHERE tenant_id = ${tenant.id}
        ${typeFilter ? sql`AND event_type LIKE ${typeFilter + '%'}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    // Total count for pagination
    const [countRow] = await sql`
      SELECT COUNT(*)::int AS total
      FROM customer_events
      WHERE tenant_id = ${tenant.id}
        ${typeFilter ? sql`AND event_type LIKE ${typeFilter + '%'}` : sql``}
    `

    // Unread count — events newer than the provided `since` timestamp
    let unreadCount = 0
    if (since) {
      const [unreadRow] = await sql`
        SELECT COUNT(*)::int AS unread_count
        FROM customer_events
        WHERE tenant_id = ${tenant.id}
          AND created_at > ${since}
          ${typeFilter ? sql`AND event_type LIKE ${typeFilter + '%'}` : sql``}
      `
      unreadCount = unreadRow?.unreadCount ?? 0
    }

    const data = events.map((e: any) => ({
      id: e.id,
      eventType: e.eventType,
      description: e.description,
      entityType: e.entityType,
      entityId: e.entityId,
      createdAt: e.createdAt,
      metadata: e.metadata ?? null,
      link: buildLink(tenantSlug, e.entityType, e.entityId),
    }))

    return NextResponse.json({
      data,
      total: countRow?.total ?? 0,
      unreadCount,
      page,
      limit,
    })
  } catch (error) {
    console.error('[GET /api/portal/notifications] Error:', error)
    return NextResponse.json({ error: 'Failed to load notifications' }, { status: 500 })
  }
}

// ── PATCH ────────────────────────────────────────────────────

export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantSlug } = await params
  const result = await resolveTenant(session, tenantSlug, 'PATCH /api/portal/notifications')
  if (result.error) return result.error

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { lastReadAt } = body ?? {}
  if (!lastReadAt || typeof lastReadAt !== 'string') {
    return NextResponse.json(
      { error: 'lastReadAt (ISO timestamp string) is required' },
      { status: 400 },
    )
  }

  // Validate the timestamp is parseable
  const parsed = Date.parse(lastReadAt)
  if (isNaN(parsed)) {
    return NextResponse.json({ error: 'lastReadAt must be a valid ISO timestamp' }, { status: 400 })
  }

  // MVP: We acknowledge the timestamp. The client stores lastReadAt in
  // localStorage and sends it as the `since` param on GET to calculate
  // unread counts. No server-side persistence needed for now.
  return NextResponse.json({ data: { acknowledged: true, lastReadAt } })
}
