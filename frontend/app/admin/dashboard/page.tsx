import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import Link from 'next/link';

type StatCard = {
  label: string;
  value: number;
  href: string;
  color: string;
};

type RecentEvent = {
  id: string;
  namespace: string;
  type: string;
  phase: string | null;
  actorType: string | null;
  actorEmail: string | null;
  actorId: string | null;
  tenantId: string | null;
  createdAt: Date;
};

const NAMESPACE_COLORS: Record<string, string> = {
  identity: 'text-blue-600 bg-blue-50',
  finder: 'text-indigo-600 bg-indigo-50',
  capture: 'text-green-600 bg-green-50',
  admin: 'text-yellow-700 bg-yellow-50',
  library: 'text-teal-600 bg-teal-50',
  proposal: 'text-purple-600 bg-purple-50',
  agent: 'text-orange-600 bg-orange-50',
  cms: 'text-pink-600 bg-pink-50',
};

function relativeTime(d: Date): string {
  const now = Date.now();
  const then = d.getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

async function safeCount(query: Promise<{ count: number }[]>): Promise<number> {
  try {
    const [row] = await query;
    return Number(row?.count ?? 0);
  } catch (e) {
    console.error('[admin/dashboard] count query failed:', e);
    return -1; // signals failure
  }
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    redirect('/login');
  }

  // Run all stat queries in parallel, each individually protected
  const [
    pendingApps,
    activeTenants,
    libraryAtoms,
    activeProposals,
    rfpsCuration,
    eventsToday,
    sbirCompanies,
    sbirAwards,
  ] = await Promise.all([
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM applications WHERE status = 'pending'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM tenants WHERE status = 'active'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM library_units WHERE status = 'approved'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM proposals WHERE stage NOT IN ('submitted', 'archived')`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM curated_solicitations WHERE status IN ('new', 'claimed', 'curation_in_progress', 'review_requested')`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM system_events WHERE created_at > NOW() - INTERVAL '24 hours'`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM sbir_companies`),
    safeCount(sql<{ count: number }[]>`SELECT COUNT(*) FROM sbir_awards`),
  ]);

  const stats: StatCard[] = [
    { label: 'Pending Applications', value: pendingApps, href: '/admin/applications', color: 'border-amber-400 bg-amber-50' },
    { label: 'Active Tenants', value: activeTenants, href: '/admin/tenants', color: 'border-blue-400 bg-blue-50' },
    { label: 'Library Atoms', value: libraryAtoms, href: '/admin/content', color: 'border-teal-400 bg-teal-50' },
    { label: 'Active Proposals', value: activeProposals, href: '/admin/proposals', color: 'border-purple-400 bg-purple-50' },
    { label: 'RFPs in Curation', value: rfpsCuration, href: '/admin/rfp-curation', color: 'border-green-400 bg-green-50' },
    { label: 'Events Today', value: eventsToday, href: '/admin/events', color: 'border-indigo-400 bg-indigo-50' },
    { label: 'SBIR Companies', value: sbirCompanies, href: '/admin/sources', color: 'border-orange-400 bg-orange-50' },
    { label: 'SBIR Awards', value: sbirAwards, href: '/admin/sources', color: 'border-pink-400 bg-pink-50' },
  ];

  // Recent events
  let recentEvents: RecentEvent[] = [];
  try {
    recentEvents = await sql<RecentEvent[]>`
      SELECT id, namespace, type, phase, actor_type, actor_email, actor_id, tenant_id, created_at
      FROM system_events
      ORDER BY created_at DESC
      LIMIT 10
    `;
  } catch (e) {
    console.error('[admin/dashboard] recent events query failed:', e);
  }

  // Pending actions counts
  let unclaimed = 0;
  try {
    const [row] = await sql<{ count: number }[]>`SELECT COUNT(*) FROM curated_solicitations WHERE status = 'new'`;
    unclaimed = Number(row?.count ?? 0);
  } catch (e) {
    console.error('[admin/dashboard] unclaimed rfps query failed:', e);
  }

  let draftAtoms = 0;
  try {
    const [row] = await sql<{ count: number }[]>`SELECT COUNT(*) FROM library_units WHERE status = 'draft'`;
    draftAtoms = Number(row?.count ?? 0);
  } catch (e) {
    console.error('[admin/dashboard] draft atoms query failed:', e);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">System overview</p>
      </div>

      {/* Stat cards grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className={`block border-l-4 rounded-lg p-4 hover:shadow-md transition-shadow ${s.color}`}
          >
            <p className="text-xs text-gray-500 uppercase font-medium">{s.label}</p>
            <p className="text-2xl font-bold mt-1">
              {s.value === -1 ? (
                <span className="text-gray-400 text-sm">unavailable</span>
              ) : (
                s.value.toLocaleString()
              )}
            </p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent events — 2/3 width */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent Events</h2>
            <Link href="/admin/events" className="text-sm text-blue-600 hover:underline">
              View all
            </Link>
          </div>
          {recentEvents.length === 0 ? (
            <p className="text-sm text-gray-400 py-4">No events recorded</p>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                    <th className="px-3 py-2 font-medium">Time</th>
                    <th className="px-3 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">Phase</th>
                    <th className="px-3 py-2 font-medium">Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {recentEvents.map((ev) => {
                    const nsColor = NAMESPACE_COLORS[ev.namespace] ?? 'text-gray-600 bg-gray-50';
                    const phaseColors: Record<string, string> = {
                      start: 'bg-blue-100 text-blue-700',
                      end: 'bg-green-100 text-green-700',
                      single: 'bg-gray-100 text-gray-700',
                      error: 'bg-red-100 text-red-700',
                    };
                    return (
                      <tr key={ev.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-3 py-1.5 text-xs text-gray-500 whitespace-nowrap">
                          {relativeTime(ev.createdAt)}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${nsColor}`}>
                            {ev.namespace}.{ev.type}
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          {ev.phase ? (
                            <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${phaseColors[ev.phase] ?? 'bg-gray-100 text-gray-600'}`}>
                              {ev.phase}
                            </span>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-gray-600">
                          {ev.actorEmail ?? ev.actorId ?? '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pending actions — 1/3 width */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Pending Actions</h2>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            <Link
              href="/admin/applications"
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
            >
              <span className="text-sm text-gray-700">Pending applications</span>
              <span className={`text-sm font-bold ${pendingApps > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {pendingApps === -1 ? '?' : pendingApps}
              </span>
            </Link>
            <Link
              href="/admin/rfp-curation"
              className="flex items-center justify-between px-4 py-3 hover:bg-gray-50"
            >
              <span className="text-sm text-gray-700">Unclaimed RFPs</span>
              <span className={`text-sm font-bold ${unclaimed > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {unclaimed}
              </span>
            </Link>
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm text-gray-700">Draft atoms awaiting review</span>
              <span className={`text-sm font-bold ${draftAtoms > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                {draftAtoms}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
