/**
 * /admin/scouts — Scout worker-pool monitor (#103).
 *
 * The Source Scouts run as `pipeline_jobs kind='scout_source'` workers that visit
 * configured source_profiles, diff them, and surface meaningful changes. Setup +
 * "Scout Now" live on /admin/sources; this is the MONITOR: which sources are being
 * watched, when each was last read, recent runs, and changes detected — read-only.
 *
 * ─────────────────────────────────────────────────────────────────────────────────
 * WHY THIS DOES NOT READ `source_health` (bug log B53)
 *
 * It used to. The page showed ACTIVE SOURCES 6 · **HEALTHY 0** · DEGRADED 0, every row
 * reading `unknown` / `never` / `—`, beside four *completed* runs — which an operator
 * reads as a dead worker pool.
 *
 * Nothing was wrong with the pool. `source_health` is written EXACTLY ONCE in the
 * repository's history: three seed rows in `db/migrations/002_seed_system.sql`, status
 * defaulted. **No runtime writer exists** in the frontend or the pipeline. So the HEALTHY
 * and DEGRADED tiles were structurally always 0 — forever, by construction. The join
 * compounded it: `ON sh.source = sp.site_type` matched one of six profiles, and two of
 * the three health rows (`grants_gov`, `sbir_gov`) matched no profile at all.
 *
 * A tile bound to a table nothing populates renders a confident zero, and a zero reads as
 * a MEASUREMENT rather than an absence. That is the same failure the ingest-provenance
 * doctrine forbids for solicitation values: *a value the product did not read must never
 * look like one it did.* An instrument is held to the same rule.
 *
 * So this now derives status from what the scout genuinely writes on every run —
 * `source_profiles.last_crawl_at` (the automated pass, `lib/tools/source-scout.ts` §5) and
 * `source_diffs` (per profile) — plus `last_visited_at`, the separate HITL "an admin opened
 * this" stamp. Where there is no signal the cell says so instead of showing a zero.
 * ─────────────────────────────────────────────────────────────────────────────────
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
  autoCrawlEnabled: boolean | null;
  crawlCron: string | null;
  lastCrawlAt: Date | null;
  lastVisitedAt: Date | null;
  diffCount: number;
  lastDiffAt: Date | null;
};
type RunRow = {
  id: string; source: string; status: string; workerId: string | null;
  startedAt: Date | null; completedAt: Date | null; createdAt: Date;
};
type DiffRow = {
  id: string; name: string | null; summary: string | null; severity: string | null;
  isMeaningful: boolean; createdAt: Date;
};

/**
 * Watch status, derived — every value below is a statement about data the scout actually wrote.
 *   paused        is_active = false. Nobody is watching this, deliberately.
 *   manual        Active, auto-crawl OFF. A person reads this source; that is not a fault, and
 *                 calling it "unhealthy" is what made the old panel unreadable.
 *   never crawled Auto-crawl ON and last_crawl_at IS NULL — the one that genuinely wants a look.
 *   overdue       Auto-crawl ON but the last pass is older than STALE_AFTER_MS.
 *   watched       Auto-crawl ON and read recently.
 */
const STATUS_BADGE: Record<string, string> = {
  watched: 'bg-green-100 text-green-700',
  overdue: 'bg-amber-100 text-amber-700',
  'never crawled': 'bg-red-100 text-red-700',
  manual: 'bg-blue-100 text-blue-700',
  paused: 'bg-gray-100 text-gray-500',
};
/**
 * Two days. `crawl_cron` defaults to `0 6 * * *` (daily), so one missed pass is noise and two is a
 * signal. Deliberately a flat floor rather than a parse of each row's cron: a monitor that needs a
 * cron parser to say whether a number is late is a worse instrument than one that says "older than
 * two days" and means it.
 */
const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

function watchStatus(p: PoolRow): keyof typeof STATUS_BADGE {
  if (!p.isActive) return 'paused';
  if (!p.autoCrawlEnabled) return 'manual';
  if (!p.lastCrawlAt) return 'never crawled';
  return Date.now() - new Date(p.lastCrawlAt).getTime() > STALE_AFTER_MS ? 'overdue' : 'watched';
}
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
    // Configured scout targets, joined to the record each pass actually leaves behind: the
    // profile's own last_crawl_at (source-scout §5) and its source_diffs. See the B53 note above
    // for why source_health is not in this query. Counts cast ::int — postgres.js returns int8 as
    // a string, and a string in `diffCount` would sort and compare wrong.
    pool = await sql<PoolRow[]>`
      SELECT sp.id, sp.name, sp.site_type, sp.agency, sp.is_active,
             sp.auto_crawl_enabled, sp.crawl_cron, sp.last_crawl_at, sp.last_visited_at,
             COALESCE(d.diff_count, 0)::int AS diff_count, d.last_diff_at
      FROM source_profiles sp
      LEFT JOIN (
        SELECT profile_id, count(*)::int AS diff_count, max(created_at) AS last_diff_at
        FROM source_diffs GROUP BY profile_id
      ) d ON d.profile_id = sp.id
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

  const status = new Map(pool.map((p) => [p.id, watchStatus(p)]));
  const countBy = (...s: string[]) => pool.filter((p) => s.includes(status.get(p.id) as string)).length;
  const active = pool.filter((p) => p.isActive).length;
  const changes24h = diffs.filter((d) => Date.now() - new Date(d.createdAt).getTime() < 86400000).length;
  const running = runs.filter((r) => r.status === 'running').length;

  // Every tile counts something a writer produces. "Needs a look" is the one an operator acts on,
  // and it is 0 only when it is genuinely 0 — unlike the HEALTHY tile it replaces, which was 0 by
  // construction and therefore said nothing either way (B53).
  const cards: Array<[string, number, string]> = [
    ['Active sources', active, 'border-blue-400 bg-blue-50'],
    ['Auto-crawled', countBy('watched', 'overdue', 'never crawled'), 'border-green-400 bg-green-50'],
    ['Needs a look', countBy('overdue', 'never crawled'), 'border-amber-400 bg-amber-50'],
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
            The sources being watched — when each was last read, recent runs, and changes detected. Set up
            sources and run a scout on the <Link href="/admin/sources" className="text-blue-600 hover:underline">Sources</Link> page.
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

      {/* Sources being watched — status derived from what each pass actually wrote. */}
      <h2 className="text-lg font-semibold mb-1">Sources watched</h2>
      <p className="text-xs text-gray-500 mb-3">
        <strong>Auto-crawl</strong> reads the source on a schedule and records what changed.{' '}
        <strong>Manual</strong> means a person opens it — deliberate, not a fault. “Needs a look”
        counts only auto-crawl sources that have never run or are more than two days behind.
      </p>
      <div className="border border-gray-200 rounded-lg overflow-x-auto mb-8">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Agency</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Last crawl</th>
              <th className="px-3 py-2 font-medium">Last visit</th>
              <th className="px-3 py-2 font-medium">Changes</th>
            </tr>
          </thead>
          <tbody>
            {pool.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-400">No source profiles configured.</td></tr>
            )}
            {pool.map((p) => {
              const s = status.get(p.id) ?? 'paused';
              return (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <Link href={`/admin/sources/${p.id}`} className="font-medium text-gray-800 hover:text-blue-600 hover:underline">{p.name}</Link>
                    <span className="ml-2 text-[10px] text-gray-400">{p.siteType}</span>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{p.agency ?? '—'}</td>
                  <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_BADGE[s]}`}>{s}</span></td>
                  {/* A manual source has no crawl to be late for — say that, rather than "never",
                      which reads as a failure when it is the configured behaviour. */}
                  <td className="px-3 py-2 text-gray-500 text-xs">
                    {p.autoCrawlEnabled ? rel(p.lastCrawlAt) : <span className="text-gray-400">not crawled</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-500 text-xs">{rel(p.lastVisitedAt)}</td>
                  <td className="px-3 py-2 text-xs tabular-nums">
                    {p.diffCount > 0
                      ? <span className="text-gray-700">{p.diffCount} <span className="text-gray-400">· {rel(p.lastDiffAt)}</span></span>
                      : <span className="text-gray-400">none</span>}
                  </td>
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
