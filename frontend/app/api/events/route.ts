import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { sql } from '@/lib/db'

/**
 * GET /api/events — Unified event stream API for the admin Events page
 *
 * Query params:
 *   stream: 'user' | 'system' | 'alerts' (required)
 *   limit:  number (default 100, max 500)
 *
 * Streams:
 *   - user:    customer_events (user actions, pipeline updates, account changes)
 *   - system:  opportunity_events + content_events (ingest, scoring, content automation)
 *   - alerts:  errors/warnings from pipeline_jobs + system-level content events
 */
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id || session.user.role !== 'master_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const stream = searchParams.get('stream')
  const limitParam = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '100', 10) || 100, 1), 500)

  if (!stream || !['user', 'system', 'alerts'].includes(stream)) {
    return NextResponse.json({ error: 'stream parameter is required (user|system|alerts)' }, { status: 400 })
  }

  try {
    if (stream === 'user') {
      // Customer events — user actions across all tenants
      const rows = await sql`
        SELECT
          id, tenant_id, user_id, event_type, opportunity_id,
          entity_type, entity_id, description, metadata,
          processed, processed_by, processed_at, created_at
        FROM customer_events
        ORDER BY created_at DESC
        LIMIT ${limitParam}
      `
      return NextResponse.json({ data: rows })

    } else if (stream === 'system') {
      // Opportunity events (ingest, scoring, drive) + content events (CMS actions)
      // Union both into a common shape
      const rows = await sql`
        (
          SELECT
            id,
            opportunity_id,
            event_type,
            source,
            field_changed,
            old_value,
            new_value,
            snapshot_hash,
            metadata,
            processed,
            processed_by,
            processed_at,
            created_at
          FROM opportunity_events
          ORDER BY created_at DESC
          LIMIT ${limitParam}
        )
        UNION ALL
        (
          SELECT
            id,
            NULL::uuid AS opportunity_id,
            event_type,
            source,
            page_key AS field_changed,
            NULL AS old_value,
            diff_summary AS new_value,
            NULL AS snapshot_hash,
            metadata,
            FALSE AS processed,
            NULL AS processed_by,
            NULL::timestamptz AS processed_at,
            created_at
          FROM content_events
          ORDER BY created_at DESC
          LIMIT ${limitParam}
        )
        ORDER BY created_at DESC
        LIMIT ${limitParam}
      `
      return NextResponse.json({ data: rows })

    } else {
      // Alerts stream — failed pipeline jobs + system warnings
      // Pull from pipeline_jobs where status = 'failed', plus content events
      // that may indicate issues
      const rows = await sql`
        (
          SELECT
            id,
            'error' AS level,
            source,
            COALESCE(error_message, 'Job failed with no error message') AS message,
            CASE WHEN result IS NOT NULL THEN result::text ELSE NULL END AS details,
            created_at
          FROM pipeline_jobs
          WHERE status = 'failed'
          ORDER BY created_at DESC
          LIMIT ${limitParam}
        )
        UNION ALL
        (
          SELECT
            id,
            'info' AS level,
            source,
            COALESCE(diff_summary, event_type) AS message,
            page_key AS details,
            created_at
          FROM content_events
          WHERE event_type IN ('content.auto_generated', 'content.auto_published', 'content.unpublished', 'content.rolled_back')
          ORDER BY created_at DESC
          LIMIT ${limitParam}
        )
        ORDER BY created_at DESC
        LIMIT ${limitParam}
      `
      return NextResponse.json({ data: rows })
    }
  } catch (error) {
    console.error(`[GET /api/events] stream=${stream} error:`, error)
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }
}
