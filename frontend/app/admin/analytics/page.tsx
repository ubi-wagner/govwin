import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

async function safeCount(query: Promise<{ count: number }[]>): Promise<number> {
  try {
    const [row] = await query;
    return Number(row?.count ?? 0);
  } catch (e) {
    console.error('[admin/analytics] count query failed:', e);
    return -1;
  }
}

async function safeSum(query: Promise<{ total: string }[]>): Promise<number> {
  try {
    const [row] = await query;
    return parseInt(row?.total ?? '0', 10);
  } catch (e) {
    console.error('[admin/analytics] sum query failed:', e);
    return -1;
  }
}

export default async function AnalyticsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  // ── Run all queries in parallel ───────────────────────────────────
  const [
    totalTenants,
    activeTenants,
    totalProposals,
    totalLibraryAtoms,
    winningAtoms,
    totalRevenueCents,
    activeSubscriptions,
    sourceChangesWeek,
    eventsToday,
    events7d,
  ] = await Promise.all([
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM tenants`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM tenants WHERE status = 'active'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM proposals`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM library_units`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM library_units WHERE outcome = 'awarded'`),
    safeSum(sql<{ total: string }[]>`SELECT COALESCE(SUM(amount_cents), 0)::text AS total FROM purchases WHERE status = 'completed'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM tenants WHERE subscription_status = 'active'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM source_diffs WHERE created_at > NOW() - INTERVAL '7 days'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM system_events WHERE created_at > NOW() - INTERVAL '24 hours'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM system_events WHERE created_at > NOW() - INTERVAL '7 days'`),
  ]);

  // ── Proposals by stage ────────────────────────────────────────────
  interface StageRow { stage: string; count: number }
  let proposalsByStage: StageRow[] = [];
  try {
    proposalsByStage = await sql<StageRow[]>`
      SELECT stage, COUNT(*)::int AS count
      FROM proposals
      GROUP BY stage
      ORDER BY count DESC
    `;
  } catch (e) {
    console.error('[admin/analytics] proposals by stage failed', e);
  }

  // ── Library atoms by category ─────────────────────────────────────
  interface CatRow { category: string; count: number }
  let atomsByCategory: CatRow[] = [];
  try {
    atomsByCategory = await sql<CatRow[]>`
      SELECT category, COUNT(*)::int AS count
      FROM library_units
      GROUP BY category
      ORDER BY count DESC
      LIMIT 10
    `;
  } catch (e) {
    console.error('[admin/analytics] atoms by category failed', e);
  }

  // ── Events by day (last 7 days) ───────────────────────────────────
  interface DayRow { day: string; count: number }
  let eventsByDay: DayRow[] = [];
  try {
    eventsByDay = await sql<DayRow[]>`
      SELECT DATE(created_at)::text AS day, COUNT(*)::int AS count
      FROM system_events
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY DATE(created_at)
      ORDER BY day ASC
    `;
  } catch (e) {
    console.error('[admin/analytics] events by day failed', e);
  }

  // ── Visitor Traffic Metrics ───────────────────────────────────────
  const [
    visitors24h,
    pageViews24h,
    visitors7d,
    pageViews7d,
  ] = await Promise.all([
    safeCount(sql<{ count: number }[]>`SELECT COUNT(DISTINCT session_id) FROM visitor_sessions WHERE created_at > NOW() - INTERVAL '24 hours'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM page_views WHERE created_at > NOW() - INTERVAL '24 hours'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(DISTINCT session_id) FROM visitor_sessions WHERE created_at > NOW() - INTERVAL '7 days'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM page_views WHERE created_at > NOW() - INTERVAL '7 days'`),
  ]);

  // ── Top pages (7d) ────────────────────────────────────────────────
  interface PageRow { pagePath: string; views: number }
  let topPages: PageRow[] = [];
  try {
    topPages = await sql<PageRow[]>`
      SELECT page_path AS "pagePath", COUNT(*)::int AS views
      FROM page_views
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY page_path
      ORDER BY views DESC
      LIMIT 10
    `;
  } catch (e) {
    console.error('[admin/analytics] top pages query failed', e);
  }

  // ── Top referrers (7d) ────────────────────────────────────────────
  interface ReferrerRow { referrer: string; count: number }
  let topReferrers: ReferrerRow[] = [];
  try {
    topReferrers = await sql<ReferrerRow[]>`
      SELECT referrer, COUNT(*)::int AS count
      FROM page_views
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND referrer IS NOT NULL AND referrer != ''
      GROUP BY referrer
      ORDER BY count DESC
      LIMIT 5
    `;
  } catch (e) {
    console.error('[admin/analytics] top referrers query failed', e);
  }

  // ── Device breakdown (7d) ─────────────────────────────────────────
  interface DeviceRow { deviceType: string; count: number }
  let deviceBreakdown: DeviceRow[] = [];
  try {
    deviceBreakdown = await sql<DeviceRow[]>`
      SELECT device_type AS "deviceType", COUNT(*)::int AS count
      FROM visitor_sessions
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND device_type IS NOT NULL
      GROUP BY device_type
      ORDER BY count DESC
    `;
  } catch (e) {
    console.error('[admin/analytics] device breakdown query failed', e);
  }

  // ── Average time on page (7d) ─────────────────────────────────────
  let avgDuration = -1;
  try {
    const [row] = await sql<{ avg: string }[]>`
      SELECT COALESCE(ROUND(AVG(duration_ms)), 0)::text AS avg
      FROM page_views
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND duration_ms IS NOT NULL AND duration_ms > 0
    `;
    avgDuration = parseInt(row?.avg ?? '0', 10);
  } catch (e) {
    console.error('[admin/analytics] avg duration query failed', e);
  }

  // ── UTM campaign breakdown (7d) ───────────────────────────────────
  interface UtmRow { utmCampaign: string; count: number }
  let utmCampaigns: UtmRow[] = [];
  try {
    utmCampaigns = await sql<UtmRow[]>`
      SELECT utm_campaign AS "utmCampaign", COUNT(*)::int AS count
      FROM page_views
      WHERE created_at > NOW() - INTERVAL '7 days'
        AND utm_campaign IS NOT NULL AND utm_campaign != ''
      GROUP BY utm_campaign
      ORDER BY count DESC
      LIMIT 10
    `;
  } catch (e) {
    console.error('[admin/analytics] utm campaign query failed', e);
  }

  const formatVal = (v: number) => (v === -1 ? 'N/A' : v.toLocaleString());

  return (
    <div className="max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-gray-500 mt-1">Platform metrics at a glance</p>
      </header>

      {/* Top-level metrics */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <MetricCard label="Total Tenants" value={formatVal(totalTenants)} />
        <MetricCard label="Active Tenants" value={formatVal(activeTenants)} />
        <MetricCard label="Total Proposals" value={formatVal(totalProposals)} />
        <MetricCard label="Library Atoms" value={formatVal(totalLibraryAtoms)} />
        <MetricCard label="Winning Atoms" value={formatVal(winningAtoms)} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard
          label="Total Revenue"
          value={totalRevenueCents === -1 ? 'N/A' : `$${(totalRevenueCents / 100).toFixed(2)}`}
        />
        <MetricCard label="Active Subscriptions" value={formatVal(activeSubscriptions)} />
        <MetricCard label="Source Changes (7d)" value={formatVal(sourceChangesWeek)} />
        <MetricCard label="Events Today" value={formatVal(eventsToday)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Proposals by stage */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Proposals by Stage</h2>
          {proposalsByStage.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No proposals yet.</p>
          ) : (
            <div className="space-y-3">
              {proposalsByStage.map((s) => (
                <div key={s.stage} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 capitalize">{s.stage.replace('_', ' ')}</span>
                  <span className="text-sm font-bold text-gray-900">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Library by category */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Atoms by Category</h2>
          {atomsByCategory.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No atoms yet.</p>
          ) : (
            <div className="space-y-3">
              {atomsByCategory.map((c) => (
                <div key={c.category} className="flex items-center justify-between">
                  <span className="text-sm text-gray-700">{c.category}</span>
                  <span className="text-sm font-bold text-gray-900">{c.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Event volume */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4">Event Volume (7 days)</h2>
          <p className="text-xs text-gray-500 mb-3">{formatVal(events7d)} events total</p>
          {eventsByDay.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No events recorded.</p>
          ) : (
            <div className="space-y-2">
              {eventsByDay.map((d) => {
                const maxCount = Math.max(...eventsByDay.map(e => e.count), 1);
                const widthPct = Math.max((d.count / maxCount) * 100, 2);
                return (
                  <div key={d.day} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-20 flex-shrink-0">
                      {new Date(d.day + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div
                        className="bg-indigo-500 h-full rounded-full"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-700 w-10 text-right">{d.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Visitor Traffic Section ──────────────────────────────────── */}
      <hr className="my-10 border-gray-200" />
      <header className="mb-6">
        <h2 className="text-xl font-bold">Visitor Traffic</h2>
        <p className="text-sm text-gray-500 mt-1">Page views and session analytics</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <MetricCard label="Unique Visitors (24h)" value={formatVal(visitors24h)} />
        <MetricCard label="Page Views (24h)" value={formatVal(pageViews24h)} />
        <MetricCard label="Unique Visitors (7d)" value={formatVal(visitors7d)} />
        <MetricCard label="Page Views (7d)" value={formatVal(pageViews7d)} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-8">
        <MetricCard
          label="Avg. Time on Page (7d)"
          value={avgDuration === -1 ? 'N/A' : avgDuration === 0 ? '0s' : `${(avgDuration / 1000).toFixed(1)}s`}
        />
        {deviceBreakdown.map((d) => (
          <MetricCard
            key={d.deviceType}
            label={`${d.deviceType.charAt(0).toUpperCase() + d.deviceType.slice(1)} Visitors (7d)`}
            value={formatVal(d.count)}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-8">
        {/* Top Pages */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 lg:col-span-2">
          <h3 className="text-lg font-semibold mb-4">Top Pages (7 days)</h3>
          {topPages.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No page view data yet.</p>
          ) : (
            <div className="space-y-3">
              {topPages.map((p) => {
                const maxViews = Math.max(...topPages.map((x) => x.views), 1);
                const widthPct = Math.max((p.views / maxViews) * 100, 2);
                return (
                  <div key={p.pagePath} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-48 flex-shrink-0 truncate" title={p.pagePath}>
                      {p.pagePath}
                    </span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full rounded-full"
                        style={{ width: `${widthPct}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-gray-700 w-12 text-right">{p.views}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top Referrers */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h3 className="text-lg font-semibold mb-4">Top Referrers (7 days)</h3>
          {topReferrers.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No referrer data yet.</p>
          ) : (
            <div className="space-y-3">
              {topReferrers.map((r) => (
                <div key={r.referrer} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600 truncate max-w-[200px]" title={r.referrer}>
                    {r.referrer}
                  </span>
                  <span className="text-sm font-bold text-gray-900">{r.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* UTM Campaign Breakdown */}
      {utmCampaigns.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
          <h3 className="text-lg font-semibold mb-4">UTM Campaigns (7 days)</h3>
          <div className="space-y-3">
            {utmCampaigns.map((u) => (
              <div key={u.utmCampaign} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{u.utmCampaign}</span>
                <span className="text-sm font-bold text-gray-900">{u.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <p className="text-xs text-gray-500 uppercase font-medium">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  );
}
