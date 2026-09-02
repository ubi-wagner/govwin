import Link from 'next/link';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import { getCoverage, effectiveState, STATE_COPY, type GuideState } from '@/lib/guides/coverage';

export const dynamic = 'force-dynamic';

/**
 * /admin/guides — which surfaces explain themselves, and which do not.
 *
 * ── WHY THIS PAGE EXISTS ─────────────────────────────────────────────────────────────────────
 * Guides are written one surface at a time, over months, by whoever happens to be in that part of
 * the product. Without a board, "which ones are done" lives in somebody's head — and the ones that
 * quietly went out of date are precisely the ones nobody thinks to check, because a guide that was
 * finished once feels finished forever.
 *
 * So this is the queue and the alarm in one place. `none` rows are the work not started; `stale`
 * rows are the work that came undone when a surface moved. Uncovered is not passing, and the count
 * at the top says so out loud rather than showing four green rows and no denominator.
 *
 * ── NOTHING HERE IS STORED ───────────────────────────────────────────────────────────────────
 * There is no status column and no "mark as done" button, deliberately. Every state is derived:
 * `<Unwritten>` sections come from the guide's own source, unresolved notes from `working_notes`,
 * and `stale` from git — did the surface change after the guide last did. A flag someone must
 * remember to set is a flag that lies, and it lies worst about the guides nobody has opened
 * recently. See `scripts/catalog-guides.mjs`.
 */
export default async function GuideCoveragePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role as Role | undefined;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) redirect('/login');

  const cov = await getCoverage();

  if (cov.missing) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-2xl font-bold">Guide coverage</h1>
        <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">The coverage artifact is not in this build.</p>
          <p className="mt-1">
            It is generated in the repo, where the sources and the git history are:
            <code className="ml-1 rounded bg-white px-1 py-0.5 font-mono text-[12px]">node frontend/scripts/catalog-guides.mjs</code>
          </p>
          <p className="mt-2">
            Showing nothing would read like full coverage, which is the opposite of the truth, so
            this page says it cannot answer instead.
          </p>
        </div>
      </div>
    );
  }

  const rows = cov.rows.map((r) => ({ ...r, live: effectiveState(r, cov.openNotes), notes: cov.openNotes[r.route] ?? 0 }));
  const count = (s: GuideState) => rows.filter((r) => r.live === s).length;
  const ORDER: Record<GuideState, number> = { stale: 0, open: 1, none: 2, ready: 3 };
  const sorted = [...rows].sort((a, b) => ORDER[a.live] - ORDER[b.live] || a.route.localeCompare(b.route));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Guide coverage</h1>
        <p className="mt-1 text-sm text-gray-500">
          Which admin surfaces explain themselves. State is derived — from the guide&rsquo;s own
          unwritten sections, from unresolved notes, and from whether the surface changed after the
          guide did. Nothing here is a flag anyone sets.
        </p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['stale', 'open', 'none', 'ready'] as GuideState[]).map((s) => (
          <div key={s} className="rounded-lg border border-gray-200 bg-white p-4">
            <div className="text-xs uppercase tracking-wide text-gray-500">{STATE_COPY[s].label}</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-gray-900">{count(s)}</div>
            <div className="mt-1 text-xs text-gray-500">{STATE_COPY[s].hint}</div>
          </div>
        ))}
      </div>

      <p className="mb-4 text-sm text-gray-600">
        <strong>{rows.length}</strong> admin surfaces. <strong>{count('none')}</strong> have no guide
        at all — that is the queue, and it is the number that decides whether this board is telling
        you the truth. Notes come from{' '}
        <Link href="/admin/notes" className="text-blue-700 hover:underline">the shared board</Link>.
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">State</th>
              <th className="px-4 py-3 font-medium">Surface</th>
              <th className="px-4 py-3 font-medium">Steps</th>
              <th className="px-4 py-3 font-medium">Unwritten</th>
              <th className="px-4 py-3 font-medium">Open notes</th>
              <th className="px-4 py-3 font-medium">Canonical doc</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((r) => (
              <tr key={r.route} className="hover:bg-gray-50">
                <td className="px-4 py-2.5">
                  <span
                    title={STATE_COPY[r.live].hint}
                    className={`inline-block rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${STATE_COPY[r.live].tone}`}
                  >
                    {STATE_COPY[r.live].label}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <Link href={r.route} className="font-mono text-[12px] text-blue-700 hover:underline">{r.route}</Link>
                  {r.live === 'stale' && (
                    <span className="ml-2 text-[11px] text-red-700">changed after the guide was written</span>
                  )}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-gray-700">{r.steps.length || '—'}</td>
                <td className="px-4 py-2.5 tabular-nums text-gray-700">{r.unwritten || '—'}</td>
                <td className="px-4 py-2.5 tabular-nums text-gray-700">{r.notes || '—'}</td>
                <td className="px-4 py-2.5 text-[12px] text-gray-500">{r.canon ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-400">
        Repo half generated {cov.generatedAt ? new Date(cov.generatedAt).toISOString().slice(0, 10) : '—'} by{' '}
        <code className="font-mono">catalog-guides.mjs</code>; note counts are live.
      </p>
    </div>
  );
}
