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

// ── Session drill-down ───────────────────────────────────────────────────────

export interface SessionEvent {
  path: string;
  at: string;             // ISO timestamp of the page view
  durationMs: number | null;
  utmSource: string | null;
}

export interface VisitorSession {
  sessionId: string;
  ipHash: string | null;  // SHA-256 fingerprint — raw IP is never stored
  deviceType: string | null;
  userAgent: string | null;
  referrer: string | null;
  firstPage: string | null;
  pageCount: number | null;
  firstSeen: string | null;
  lastSeen: string | null;
  events: SessionEvent[];
}

/**
 * Most recent visitor sessions with their full page-view timeline. Ordered by
 * last activity. Per-session events are capped to keep payloads bounded. Reads
 * the enhanced beacon columns (ip_hash, device_type, duration_ms, utm_*); if a
 * DB lacks them the whole call degrades to [] (wrapped).
 */
export async function getRecentSessions(limit = 30, eventCap = 80): Promise<VisitorSession[]> {
  try {
    const sessions = await sql<
      {
        sessionId: string; ipHash: string | null; deviceType: string | null;
        userAgent: string | null; referrer: string | null; firstPage: string | null;
        pageCount: number | null; createdAt: Date | null; lastSeenAt: Date | null;
      }[]
    >`
      SELECT session_id, ip_hash, device_type, user_agent, referrer, first_page,
             page_count, created_at, last_seen_at
      FROM visitor_sessions
      ORDER BY last_seen_at DESC NULLS LAST, created_at DESC
      LIMIT ${limit}
    `;
    if (sessions.length === 0) return [];
    const ids = sessions.map((s) => s.sessionId);
    const events = await sql<
      { sessionId: string; pagePath: string; createdAt: Date; durationMs: number | null; utmSource: string | null }[]
    >`
      SELECT session_id, page_path, created_at, duration_ms, utm_source
      FROM page_views
      WHERE session_id = ANY(${ids})
      ORDER BY created_at ASC
    `;
    const byId = new Map<string, SessionEvent[]>();
    for (const e of events) {
      const list = byId.get(e.sessionId) ?? [];
      if (list.length < eventCap) {
        list.push({
          path: e.pagePath,
          at: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
          durationMs: e.durationMs,
          utmSource: e.utmSource,
        });
      }
      byId.set(e.sessionId, list);
    }
    return sessions.map((s) => ({
      sessionId: s.sessionId,
      ipHash: s.ipHash,
      deviceType: s.deviceType,
      userAgent: s.userAgent,
      referrer: s.referrer,
      firstPage: s.firstPage,
      pageCount: s.pageCount,
      firstSeen: s.createdAt instanceof Date ? s.createdAt.toISOString() : (s.createdAt ? String(s.createdAt) : null),
      lastSeen: s.lastSeenAt instanceof Date ? s.lastSeenAt.toISOString() : (s.lastSeenAt ? String(s.lastSeenAt) : null),
      events: byId.get(s.sessionId) ?? [],
    }));
  } catch (e) {
    console.error('[analytics-admin/getRecentSessions] error:', e);
    return [];
  }
}
