// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { OppWatchToggle } from '@/components/admin/opp-watch-toggle';

export const dynamic = 'force-dynamic';

// Cross-portal project-status rollup (control-plane F3), keyed by the immutable
// opportunity_id (R0). Reads v_opportunity_rollup — status from the domain tables,
// no instance fan-out. One row per opportunity that has customer pipeline activity.
type RollupRow = {
  opportunityId: string;
  title: string;
  agency: string | null;
  programType: string | null;
  lifecycleStatus: string;
  closeDate: Date | null;
  rankedTenants: number;
  pinnedTenants: number;
  proposals: number;
  proposalsInBuild: number;
  proposalsFinal: number;
  proposalsSubmitted: number;
  proposalsArchived: number;
  lastProposalActivity: Date | null;
  contracts: number;
  updateWatch: boolean;
};

const LIFECYCLE_COLORS: Record<string, string> = {
  open: 'bg-green-100 text-green-700',
  closed: 'bg-amber-100 text-amber-700',
  archived: 'bg-gray-100 text-gray-500',
};

function Stage({ n, label, color }: { n: number; label: string; color: string }) {
  if (!n) return null;
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${color}`} title={label}>
      {n} {label}
    </span>
  );
}

export default async function AdminOpportunityRollupPage() {
  const session = await auth();
  if (!session?.user) redirect('/admin');
  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  let rows: RollupRow[] = [];
  try {
    rows = await sql<RollupRow[]>`
      SELECT r.opportunity_id, r.title, r.agency, r.program_type, r.lifecycle_status, r.close_date,
             r.ranked_tenants::int        AS ranked_tenants,
             r.pinned_tenants::int        AS pinned_tenants,
             r.proposals::int             AS proposals,
             r.proposals_in_build::int    AS proposals_in_build,
             r.proposals_final::int       AS proposals_final,
             r.proposals_submitted::int   AS proposals_submitted,
             r.proposals_archived::int    AS proposals_archived,
             r.contracts::int             AS contracts,
             r.last_proposal_activity,
             COALESCE(o.update_watch, false) AS update_watch
      FROM v_opportunity_rollup r
      LEFT JOIN opportunities o ON o.id = r.opportunity_id
      WHERE r.ranked_tenants > 0 OR r.proposals > 0
      ORDER BY proposals DESC, ranked_tenants DESC, last_proposal_activity DESC NULLS LAST
      LIMIT 200
    `;
  } catch (e) {
    console.error('[admin/opportunities] rollup query failed:', e);
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Opportunity Rollup</h1>
        <p className="text-sm text-gray-500 mt-1">
          Cross-portal status by opportunity — ranked &amp; pinned across customers, and every
          proposal&apos;s build stage. One immutable opportunity, rolled up.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-8">No opportunities are in any customer pipeline yet.</p>
      ) : (
        // `overflow-x-auto`, not `overflow-hidden`. The clip was there for the rounded corners; its
        // invisible cost was the right-hand columns. At 390px this table lays out 1058px of row
        // into a 390px viewport, the body does not scroll, and the clipped 63% was simply
        // unreachable. Every viewport check in this tree had asked whether the PAGE scrolls
        // sideways — which stays "no" precisely BECAUSE the overflow is clipped, so a clipping
        // wrapper is invisible to it. Found by scripts/probe-interaction-mobile.mts.
        <div className="border border-gray-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                <th className="px-4 py-3 font-medium">Opportunity</th>
                <th className="px-4 py-3 font-medium">Lifecycle</th>
                <th className="px-4 py-3 font-medium">Close</th>
                <th className="px-4 py-3 font-medium">Ranked</th>
                <th className="px-4 py-3 font-medium">Pinned</th>
                <th className="px-4 py-3 font-medium">Proposals</th>
                <th className="px-4 py-3 font-medium">Last activity</th>
                <th className="px-4 py-3 font-medium">Updates</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lc = LIFECYCLE_COLORS[r.lifecycleStatus] ?? 'bg-gray-100 text-gray-700';
                return (
                  <tr key={r.opportunityId} className="border-t border-gray-100 hover:bg-gray-50 align-top">
                    <td className="px-4 py-3 max-w-sm">
                      <div className="font-medium text-gray-900 truncate">{r.title || 'Untitled'}</div>
                      <div className="text-xs text-gray-400">
                        {[r.agency, r.programType].filter(Boolean).join(' · ') || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${lc}`}>
                        {r.lifecycleStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {r.closeDate ? new Date(r.closeDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-700">{r.rankedTenants}</td>
                    <td className="px-4 py-3 text-gray-700">{r.pinnedTenants}</td>
                    <td className="px-4 py-3">
                      {r.proposals === 0 && r.contracts === 0 ? (
                        <span className="text-gray-400">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          <Stage n={r.proposalsInBuild} label="building" color="bg-blue-50 text-blue-700" />
                          <Stage n={r.proposalsFinal} label="final" color="bg-purple-50 text-purple-700" />
                          <Stage n={r.proposalsSubmitted} label="submitted" color="bg-green-50 text-green-700" />
                          <Stage n={r.proposalsArchived} label="archived" color="bg-gray-100 text-gray-500" />
                          {/* V2: contracts won on this opportunity (the spine's V1→V2 arc) */}
                          <Stage n={r.contracts} label="contract" color="bg-emerald-100 text-emerald-700" />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                      {r.lastProposalActivity ? new Date(r.lastProposalActivity).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <OppWatchToggle opportunityId={r.opportunityId} initial={r.updateWatch} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
