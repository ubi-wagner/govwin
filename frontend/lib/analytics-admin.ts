/**
 * Admin-side visitor analytics reads for the Site Content view (V8).
 *
 * Sourced from the public pageview beacon (page_views + visitor_sessions; see
 * app/api/analytics/pageview/route.ts). Read-only, admin-only (called from the
 * admin/site server page). Every query is wrapped — if the analytics tables are
 * absent (e.g. a fresh local DB), callers get zeros and the UI degrades cleanly.
 */
import { sql } from '@/lib/db';

export interface TopPage {
  path: string;
  views: number;
}

export interface SiteAnalytics {
  ok: boolean;
  views7d: number;
  views30d: number;
  sessions7d: number;
  sessions30d: number;
  topPages: TopPage[];
}

const EMPTY: SiteAnalytics = {
  ok: false, views7d: 0, views30d: 0, sessions7d: 0, sessions30d: 0, topPages: [],
};

/** Site-wide summary: page views + unique sessions over 7/30 days, and top pages. */
export async function getSiteAnalytics(): Promise<SiteAnalytics> {
  try {
    const [agg] = await sql<
      { views7d: number; views30d: number; sessions7d: number; sessions30d: number }[]
    >`
      SELECT
        count(*) FILTER (WHERE created_at > now() - interval '7 days')::int  AS views7d,
        count(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS views30d,
        count(DISTINCT session_id) FILTER (WHERE created_at > now() - interval '7 days')::int  AS sessions7d,
        count(DISTINCT session_id) FILTER (WHERE created_at > now() - interval '30 days')::int AS sessions30d
      FROM page_views
    `;
    const topPages = await sql<TopPage[]>`
      SELECT page_path AS path, count(*)::int AS views
      FROM page_views
      WHERE created_at > now() - interval '30 days'
      GROUP BY page_path
      ORDER BY count(*) DESC
      LIMIT 8
    `;
    return {
      ok: true,
      views7d: agg?.views7d ?? 0,
      views30d: agg?.views30d ?? 0,
      sessions7d: agg?.sessions7d ?? 0,
      sessions30d: agg?.sessions30d ?? 0,
      topPages: topPages ?? [],
    };
  } catch (e) {
    console.error('[analytics-admin/getSiteAnalytics] error:', e);
    return EMPTY;
  }
}

/** Per-path view counts over the window, keyed by page_path (for inline badges). */
export async function getPageViewCounts(days = 30): Promise<Record<string, number>> {
  try {
    const rows = await sql<TopPage[]>`
      SELECT page_path AS path, count(*)::int AS views
      FROM page_views
      WHERE created_at > now() - make_interval(days => ${days})
      GROUP BY page_path
    `;
    const map: Record<string, number> = {};
    for (const r of rows) map[r.path] = r.views;
    return map;
  } catch (e) {
    console.error('[analytics-admin/getPageViewCounts] error:', e);
    return {};
  }
}

/** Public path a page_key renders at (for matching inline view counts). */
export function pageKeyToPath(pageKey: string): string {
  if (pageKey === 'homepage') return '/';
  return `/${pageKey}`;
}
