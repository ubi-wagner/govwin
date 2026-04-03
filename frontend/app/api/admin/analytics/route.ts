/**
 * GET /api/admin/analytics — Visitor analytics overview for admin dashboard
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') ?? '30', 10)
  const since = new Date()
  since.setDate(since.getDate() - days)

  try {
    // Summary stats
    const [totals] = await sql`
      SELECT
        COUNT(*)::int AS total_visitors,
        COUNT(*) FILTER (WHERE waitlist_id IS NOT NULL)::int AS conversions,
        SUM(page_view_count)::int AS total_page_views,
        SUM(interaction_count)::int AS total_interactions
      FROM visitor_sessions
      WHERE first_seen_at >= ${since.toISOString()}
    `

    // Daily visitor counts
    const dailyVisitors = await sql`
      SELECT
        DATE(first_seen_at) AS day,
        COUNT(*)::int AS visitors,
        COUNT(*) FILTER (WHERE waitlist_id IS NOT NULL)::int AS conversions
      FROM visitor_sessions
      WHERE first_seen_at >= ${since.toISOString()}
      GROUP BY DATE(first_seen_at)
      ORDER BY day
    `

    // Top pages by views
    const topPages = await sql`
      SELECT path, COUNT(*)::int AS views, COUNT(DISTINCT visitor_id)::int AS unique_visitors,
        ROUND(AVG(COALESCE(time_on_page_ms, 0)))::int AS avg_time_ms,
        ROUND(AVG(COALESCE(scroll_depth_pct, 0)))::int AS avg_scroll_pct
      FROM page_views
      WHERE created_at >= ${since.toISOString()}
      GROUP BY path
      ORDER BY views DESC
      LIMIT 20
    `

    // Top interactions (CTA clicks, section views)
    const topInteractions = await sql`
      SELECT target, event_type, COUNT(*)::int AS count, COUNT(DISTINCT visitor_id)::int AS unique_visitors
      FROM page_interactions
      WHERE created_at >= ${since.toISOString()}
      GROUP BY target, event_type
      ORDER BY count DESC
      LIMIT 30
    `

    // Traffic sources
    const sources = await sql`
      SELECT
        COALESCE(utm_source, 'direct') AS source,
        COALESCE(utm_medium, 'none') AS medium,
        COUNT(*)::int AS visitors,
        COUNT(*) FILTER (WHERE waitlist_id IS NOT NULL)::int AS conversions
      FROM visitor_sessions
      WHERE first_seen_at >= ${since.toISOString()}
      GROUP BY utm_source, utm_medium
      ORDER BY visitors DESC
      LIMIT 20
    `

    // Device breakdown
    const devices = await sql`
      SELECT device_type, COUNT(*)::int AS count
      FROM visitor_sessions
      WHERE first_seen_at >= ${since.toISOString()} AND device_type IS NOT NULL
      GROUP BY device_type
      ORDER BY count DESC
    `

    // Recent visitor journeys (last 20 converted + last 20 non-converted)
    const recentVisitors = await sql`
      SELECT
        vs.visitor_id, vs.ip_address, vs.country, vs.city, vs.device_type, vs.browser,
        vs.utm_source, vs.utm_medium, vs.referer,
        vs.page_view_count, vs.interaction_count,
        vs.first_seen_at, vs.last_seen_at, vs.waitlist_id,
        w.email AS waitlist_email, w.full_name AS waitlist_name, w.company AS waitlist_company
      FROM visitor_sessions vs
      LEFT JOIN waitlist w ON w.id = vs.waitlist_id
      WHERE vs.first_seen_at >= ${since.toISOString()}
      ORDER BY vs.last_seen_at DESC
      LIMIT 50
    `

    return NextResponse.json({
      data: {
        totals: totals ?? { totalVisitors: 0, conversions: 0, totalPageViews: 0, totalInteractions: 0 },
        dailyVisitors,
        topPages,
        topInteractions,
        sources,
        devices,
        recentVisitors,
      },
    })
  } catch (error) {
    console.error('[GET /api/admin/analytics] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch analytics.' }, { status: 500 })
  }
}
