/**
 * GET /api/admin/analytics/visitor?id=<visitor_id>
 * Full journey for a single visitor — page views + interactions in order
 */
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const visitorId = new URL(request.url).searchParams.get('id')
  if (!visitorId) {
    return NextResponse.json({ error: 'Missing visitor id' }, { status: 400 })
  }

  try {
    const [visitor] = await sql`
      SELECT vs.*, w.email AS waitlist_email, w.full_name AS waitlist_name, w.company AS waitlist_company
      FROM visitor_sessions vs
      LEFT JOIN waitlist w ON w.id = vs.waitlist_id
      WHERE vs.visitor_id = ${visitorId}
    `

    const pageViews = await sql`
      SELECT path, page_title, referrer_path, time_on_page_ms, scroll_depth_pct, created_at
      FROM page_views WHERE visitor_id = ${visitorId}
      ORDER BY created_at
    `

    const interactions = await sql`
      SELECT path, event_type, target, target_label, metadata, created_at
      FROM page_interactions WHERE visitor_id = ${visitorId}
      ORDER BY created_at
    `

    return NextResponse.json({
      data: { visitor: visitor ?? null, pageViews, interactions },
    })
  } catch (error) {
    console.error('[GET /api/admin/analytics/visitor] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch visitor.' }, { status: 500 })
  }
}
