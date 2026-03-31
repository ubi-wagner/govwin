/**
 * GET /api/portal/[tenantSlug]/dashboard — Unified dashboard metrics
 *
 * Returns library stats, proposal pipeline counts, and recent activity
 * for the portal dashboard. All queries run in parallel via Promise.all.
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db'

type Params = { params: Promise<{ tenantSlug: string }> }

const ROUTE_TAG = 'GET /api/portal/dashboard'

export async function GET(_request: NextRequest, { params }: Params) {
  // ── Auth ──────────────────────────────────────────────────────
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { tenantSlug } = await params

  // ── Tenant resolution ─────────────────────────────────────────
  let tenant: Awaited<ReturnType<typeof getTenantBySlug>>
  try {
    tenant = await getTenantBySlug(tenantSlug)
  } catch (error) {
    console.error(`[${ROUTE_TAG}] Tenant resolution error:`, error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  }

  // ── Access check ──────────────────────────────────────────────
  let hasAccess: boolean
  try {
    hasAccess = await verifyTenantAccess(session.user.id, session.user.role, tenant.id)
  } catch (error) {
    console.error(`[${ROUTE_TAG}] Access check error:`, error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // ── Parallel queries ──────────────────────────────────────────
  try {
    const [
      libraryStats,
      topCategories,
      recentUploads,
      proposalStats,
      deadlineSoon,
      activity,
    ] = await Promise.all([
      // 1. Library unit counts
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved,
          COUNT(*) FILTER (WHERE status = 'draft')::int AS draft,
          COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded
        FROM library_units
        WHERE tenant_id = ${tenant.id} AND status != 'archived'
      `,

      // 2. Top categories
      sql`
        SELECT category, COUNT(*)::int AS count
        FROM library_units
        WHERE tenant_id = ${tenant.id} AND status != 'archived'
        GROUP BY category
        ORDER BY count DESC
        LIMIT 5
      `,

      // 3. Recent uploads (last 7 days)
      sql`
        SELECT COUNT(*)::int AS count
        FROM tenant_uploads
        WHERE tenant_id = ${tenant.id}
          AND created_at > NOW() - INTERVAL '7 days'
      `,

      // 4. Proposal stats (total, by-stage, avg completion)
      sql`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE stage = 'outline')::int AS outline,
          COUNT(*) FILTER (WHERE stage = 'draft')::int AS draft,
          COUNT(*) FILTER (WHERE stage = 'pink_team')::int AS pink_team,
          COUNT(*) FILTER (WHERE stage = 'red_team')::int AS red_team,
          COUNT(*) FILTER (WHERE stage = 'gold_team')::int AS gold_team,
          COUNT(*) FILTER (WHERE stage = 'final')::int AS final,
          COUNT(*) FILTER (WHERE stage = 'submitted')::int AS submitted,
          COUNT(*) FILTER (WHERE stage = 'archived')::int AS archived,
          COALESCE(AVG(completion_pct), 0)::float AS avg_completion
        FROM proposals
        WHERE tenant_id = ${tenant.id} AND status != 'archived'
      `,

      // 5. Proposals with deadline within 7 days
      sql`
        SELECT COUNT(*)::int AS count
        FROM proposals
        WHERE tenant_id = ${tenant.id}
          AND status != 'archived'
          AND submission_deadline IS NOT NULL
          AND submission_deadline <= NOW() + INTERVAL '7 days'
          AND submission_deadline > NOW()
      `,

      // 6. Recent activity (last 10 events)
      sql`
        SELECT id, event_type, description, created_at
        FROM customer_events
        WHERE tenant_id = ${tenant.id}
        ORDER BY created_at DESC
        LIMIT 10
      `,
    ])

    const libRow = libraryStats[0]
    const propRow = proposalStats[0]

    return NextResponse.json({
      data: {
        library: {
          totalUnits: libRow?.total ?? 0,
          approved: libRow?.approved ?? 0,
          draft: libRow?.draft ?? 0,
          embedded: libRow?.embedded ?? 0,
          topCategories: topCategories.map((r: any) => ({
            category: r.category,
            count: r.count,
          })),
          recentUploads: recentUploads[0]?.count ?? 0,
        },
        proposals: {
          total: propRow?.total ?? 0,
          byStage: {
            outline: propRow?.outline ?? 0,
            draft: propRow?.draft ?? 0,
            pink_team: propRow?.pinkTeam ?? 0,
            red_team: propRow?.redTeam ?? 0,
            gold_team: propRow?.goldTeam ?? 0,
            final: propRow?.final ?? 0,
            submitted: propRow?.submitted ?? 0,
            archived: propRow?.archived ?? 0,
          },
          avgCompletion: Math.round((propRow?.avgCompletion ?? 0) * 10) / 10,
          deadlineSoon: deadlineSoon[0]?.count ?? 0,
        },
        activity: activity.map((e: any) => ({
          id: e.id,
          eventType: e.eventType,
          description: e.description,
          createdAt: e.createdAt,
        })),
      },
    })
  } catch (error) {
    console.error(`[${ROUTE_TAG}] Dashboard query error:`, error)
    return NextResponse.json({ error: 'Failed to load dashboard metrics' }, { status: 500 })
  }
}
