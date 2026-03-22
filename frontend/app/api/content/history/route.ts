import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'

/**
 * GET /api/content/history?page=key&limit=50
 * Returns content change history for a specific page
 */
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const pageKey = searchParams.get('page')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200)

  try {
    if (pageKey) {
      const rows = await sql`
        SELECT id, page_key, event_type, user_id, diff_summary, source, metadata, created_at
        FROM content_events
        WHERE page_key = ${pageKey}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
      return NextResponse.json({ data: rows })
    }

    // All pages history
    const rows = await sql`
      SELECT id, page_key, event_type, user_id, diff_summary, source, metadata, created_at
      FROM content_events
      ORDER BY created_at DESC
      LIMIT ${limit}
    `
    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('[GET /api/content/history] Error:', error)
    return NextResponse.json({ error: 'Failed to load history' }, { status: 500 })
  }
}
