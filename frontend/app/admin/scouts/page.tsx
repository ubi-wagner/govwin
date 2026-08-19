/**
 * /admin/scouts — Scout worker-pool monitor (#103).
 *
 * The Source Scouts run as `pipeline_jobs kind='scout_source'` workers that visit
 * configured source_profiles, diff them, and surface meaningful changes. Setup +
 * "Scout Now" live on /admin/sources; this is the missing MONITOR: the pool's
 * health (source_health), recent scout runs, and changes detected — read-only.
 */
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import ScoutCandidateQueue from '@/components/scout/candidate-queue';
import IntakeStageStrip from '@/components/admin/intake-stage-strip';
import { loadIntakeStageCounts } from '@/lib/admin/intake-stage-counts';

export const dynamic = 'force-dynamic';

type PoolRow = {
  id: string;
  name: string;
  siteType: string;
  agency: string | null;
  isActive: boolean;
  lastVisitedAt: Date | null;
  healthStatus: string | null;
  consecutiveFailures: number | null;
  lastSuccessAt: Date | null;
  avgDurationMs: number | null;
};
type RunRow = {
  id: string; source: string; status: string; workerId: string | null;
  startedAt: Date | null; completedAt: Date | null; createdAt: Date;
};
type DiffRow = {
  id: string; name: string | null; summary: string | null; severity: string | null;
  isMeaningful: boolean; createdAt: Date;
};

const HEALTH_BADGE: Record<string, string> = {
  healthy: 'bg-green-100 text-green-700',
  degraded: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
  unknown: 'bg-gray-100 text-gray-500',
};
const JOB_BADGE: Record<string, string> = {
  completed: 'bg-green-100 text-green-700',
  running: 'bg-blue-100 text-blue-700',
  pending: 'bg-gray-100 text-gray-600',
  failed: 'bg-red-100 text-red-700',
};
const SEV_BADGE: Record<string, string> = {
  info: 'bg-gray-100 text-gray-600',
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-amber-100 text-amber-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

function rel(d: Date | null): string {
  if (!d) return 'never';
  const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default async function ScoutMonitorPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') redirect('/');

  let pool: PoolRow[] = [];
  let runs: RunRow[] = [];
  let diffs: DiffRow[] = [];
  try {
    // Configured scout targets, left-joined to worker health (keyed by site_type).
    pool = await sql<PoolRow[]>`
      SELECT sp.id, sp.name, sp.site_type, sp.agency, sp.is_active, sp.last_visited_at,
             sh.status AS health_status, sh.consecutive_failures, sh.last_success_at, sh.avg_duration_ms
      FROM source_profiles sp
      LEFT JOIN source_health sh ON sh.source = sp.site_type
      ORDER BY sp.is_active DESC, sp.name ASC`;
  } catch (e) { console.error('[admin/scouts] pool query failed', e); }
  try {
    runs = await sql<RunRow[]>`
      SELECT id, source, status, worker_id, started_at, completed_at, created_at
      FROM pipeline_jobs WHERE kind = 'scout_source'
      ORDER BY created_at DESC LIMIT 12`;
  } catch (e) { console.error('[admin/scouts] runs query failed', e); }
  try {
    diffs = await sql<DiffRow[]>`
      SELECT sd.id, sp.name, sd.summary, sd.severity, sd.is_meaningful, sd.created_at
      FROM source_diffs sd JOIN source_profiles sp ON sp.id = sd.profile_id
      ORDER BY sd.created_at DESC LIMIT 10`;
  } catch (e) { console.error('[admin/scouts] diffs query failed', e); }

  const active = pool.filter((p) => p.isActive).length;
  const healthy = pool.filter((p) => p.healthStatus === 'healthy').length;
  const unhealthy = pool.filter((p) => p.healthStatus === 'degraded' || p.healthStatus === 'error').length;
  const changes24h = diffs.filter((d) => Date.now() - new Date(d.createdAt).getTime() < 86400000).length;
  const running = runs.filter((r) => r.status === 'running').length;

  const cards: Array<[string, number, string]> = [
    ['Active sources', active, 'border-blue-400 bg-blue-50'],
    ['Healthy', healthy, 'border-green-400 bg-green-50'],
    ['Degraded / error', unhealthy, 'border-amber-400 bg-amber-50'],
    ['Running scouts', running, 'border-indigo-400 bg-indigo-50'],
    ['Changes (24h)', changes24h, 'border-purple-400 bg-purple-50'],
  ];

  // The discovery river's backlog, shared by every stage (#176).
  const stageCounts = await loadIntakeStageCounts();

  return (
    <div>
      <IntakeStageStrip current="scouts" counts={stageCounts} />
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scout Monitor</h1>
          <p className="text-sm text-gray-500 mt-1">
            The Source Scout worker pool — health, recent runs, and changes detected. Set up sources and
            run a scout on the <Link href="/admin/sources" className="text-blue-600 hover:underline">Sources</Link> page.
          </p>
        </div>
        <Link href="/admin/pipeline" className="text-sm text-blue-600 hover:underline">Pipeline Jobs →</Link>
      </div>

      {/* The new/updated OPP candidate review→release queue (#176) */}
      <ScoutCandidateQueue />

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        {cards.map(([label, value, color]) => (
          <div key={label} className={`border-l-4 rounded-lg p-4 ${color}`}>
            <div className="text-xs text-gray-500 uppercase tracking-wide">{label}</div>
            <div className="text-2xl font-bold mt-1">{value}</div>
          </div>
        ))}
      </div>

      {/* Worker pool health */}
      <h2 className="text-lg font-semibold mb-3">Worker Pool</h2>
      <div className="border border-gray-200 rounded-lg overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Agency</th>
              <th className="px-3 py-2 font-medium">Health</th>
              <th className="px-3 py-2 font-medium">Fails</th>
              <th className="px-3 py-2 font-medium">Last success</th>
              <th className="px-3 py-2 font-medium">Avg run</th>
              <th className="px-3 py-2 font-medium">Last visit</th>
            </tr>
          </thead>
          <tbody>
            {pool.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-400">No source profiles configured.</td></tr>
            )}
            {pool.map((p) => {
              const h = p.healthStatus ?? 'unknown';
              return (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link href={`/admin/sources/${p.id}`} className="font-medium text-gray-800 hover:text-blue-600 hover:underline">{p.name}</Link>
                    {!p.isActive && <span className="ml-2 text-[10px] uppercase text-gray-400">paused</span>}
                    <span className="ml-2 text-[10px] text-gray-400">{p.siteType}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{p.agency ?? '—'}</td>
                  <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${HEALTH_BADGE[h]}`}>{h}</span></td>
                  <td className={`px-3 py-2 ${(p.consecutiveFailures ?? 0) > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{p.consecutiveFailures ?? 0}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{rel(p.lastSuccessAt)}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{p.avgDurationMs != null ? `${(p.avgDurationMs / 1000).toFixed(1)}s` : '—'}</td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{rel(p.lastVisitedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent scout runs */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Recent scout runs</h2>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            {runs.length === 0 && <p className="px-4 py-6 text-sm text-gray-400">No scout runs yet — kick one off with “Scout Now” on a source.</p>}
            {runs.map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${JOB_BADGE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>{r.status}</span>
                <span className="text-sm font-medium text-gray-800">{r.source}</span>
                {r.workerId && <span className="text-[11px] text-gray-400">{r.workerId}</span>}
                <span className="ml-auto text-xs text-gray-400">{rel(r.completedAt ?? r.startedAt ?? r.createdAt)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Changes detected */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Changes detected</h2>
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            {diffs.length === 0 && <p className="px-4 py-6 text-sm text-gray-400">No changes detected yet.</p>}
            {diffs.map((d) => (
              <div key={d.id} className="px-4 py-2.5">
                <div className="flex items-center gap-2">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${SEV_BADGE[d.severity ?? 'info'] ?? 'bg-gray-100 text-gray-600'}`}>{d.severity ?? 'info'}</span>
                  <span className="text-sm font-medium text-gray-800">{d.name ?? 'source'}</span>
                  {d.isMeaningful && <span className="text-[10px] uppercase text-purple-600 font-medium">meaningful</span>}
                  <span className="ml-auto text-xs text-gray-400">{rel(d.createdAt)}</span>
                </div>
                {d.summary && <p className="text-xs text-gray-500 mt-0.5">{d.summary}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
