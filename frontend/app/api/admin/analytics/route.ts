/**
 * GET /api/admin/analytics
 *
 * Returns aggregate visitor traffic analytics for the admin dashboard.
 * Requires master_admin or rfp_admin role.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import type { Role } from '@/lib/rbac';

export async function GET() {
  // ── Auth check ──────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }
  const role = (session.user as { role?: Role }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') {
    return NextResponse.json(
      { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  try {
    // ── Run all queries in parallel ─────────────────────────────────
    const [
      visitors24hRows,
      pageViews24hRows,
      visitors7dRows,
      pageViews7dRows,
      topPages,
      topReferrers,
      deviceBreakdown,
    ] = await Promise.all([
      sql<{ count: number }[]>`
        SELECT COUNT(DISTINCT session_id)::int AS count
        FROM visitor_sessions
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `,
      sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM page_views
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `,
      sql<{ count: number }[]>`
        SELECT COUNT(DISTINCT session_id)::int AS count
        FROM visitor_sessions
        WHERE created_at > NOW() - INTERVAL '7 days'
      `,
      sql<{ count: number }[]>`
        SELECT COUNT(*)::int AS count
        FROM page_views
        WHERE created_at > NOW() - INTERVAL '7 days'
      `,
      sql<{ pagePath: string; views: number }[]>`
        SELECT page_path AS "pagePath", COUNT(*)::int AS views
        FROM page_views
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY page_path
        ORDER BY views DESC
        LIMIT 10
      `,
      sql<{ referrer: string; count: number }[]>`
        SELECT referrer, COUNT(*)::int AS count
        FROM page_views
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND referrer IS NOT NULL AND referrer != ''
        GROUP BY referrer
        ORDER BY count DESC
        LIMIT 5
      `,
      sql<{ deviceType: string; count: number }[]>`
        SELECT device_type AS "deviceType", COUNT(*)::int AS count
        FROM visitor_sessions
        WHERE created_at > NOW() - INTERVAL '7 days'
          AND device_type IS NOT NULL
        GROUP BY device_type
        ORDER BY count DESC
      `,
    ]);

    return NextResponse.json({
      data: {
        visitors24h: visitors24hRows[0]?.count ?? 0,
        pageViews24h: pageViews24hRows[0]?.count ?? 0,
        visitors7d: visitors7dRows[0]?.count ?? 0,
        pageViews7d: pageViews7dRows[0]?.count ?? 0,
        topPages,
        topReferrers,
        deviceBreakdown,
      },
    });
  } catch (e) {
    console.error('[api/admin/analytics] query failed:', e);
    return NextResponse.json(
      { error: 'Failed to fetch analytics data', code: 'ANALYTICS_QUERY_FAILED' },
      { status: 500 },
    );
  }
}
