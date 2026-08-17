/**
 * Release & SLA board — /admin/provisioning
 *
 * Cross-tenant roll-up of every PURCHASED portal still awaiting expert release
 * (status 'curation_pending'), sorted by the 72h curation SLA (curation_due_at) with
 * overdue first. Each row deep-links to the per-portal provisioning cockpit
 * (/admin/provisioning/[portalId]) where "Complete & Release" lives. Closes the gap where
 * the only path to a pending release was the per-purchase ToDo — nothing showed the whole
 * queue or which SLAs were at risk. Cross-tenant admin read → sqlBypass.
 */
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { sqlBypass as sql } from '@/lib/db';
import { getBuildReadiness } from '@/lib/provisioning/readiness';
import { SlaCountdown } from './[portalId]/release-panel';
import { InstantReleaseButton } from './instant-release-button';

export const dynamic = 'force-dynamic';

interface PendingPortal {
  id: string;
  label: string;
  status: string;
  curationDueAt: Date | null;
  paidAt: Date | null;
  tenantName: string;
  tenantSlug: string;
  oppTitle: string;
  agency: string | null;
  solId: string | null;
}

export default async function ReleaseSlaBoardPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  let portals: PendingPortal[] = [];
  try {
    portals = await sql<PendingPortal[]>`
      SELECT pp.id, pp.label, pp.status,
             pp.curation_due_at AS "curationDueAt", pp.paid_at AS "paidAt",
             t.name AS "tenantName", t.slug AS "tenantSlug",
             o.title AS "oppTitle", o.agency,
             -- The master solicitation behind this portal's opportunity (topic → solicitation_id,
             -- umbrella → cs.opportunity_id), for the build-out readiness gate on the fast-path release.
             (SELECT cs.id FROM curated_solicitations cs
                JOIN opportunities o2 ON (o2.solicitation_id = cs.id OR cs.opportunity_id = o2.id)
                WHERE o2.id = pp.opportunity_id LIMIT 1) AS "solId"
      FROM proposal_portals pp
      JOIN tenants t ON t.id = pp.tenant_id
      JOIN opportunities o ON o.id = pp.opportunity_id
      WHERE pp.status = 'curation_pending'
      ORDER BY pp.curation_due_at ASC NULLS LAST, pp.paid_at ASC NULLS LAST`;
  } catch (e) {
    if (e && typeof e === 'object' && 'digest' in e) throw e;
    console.error('[admin/provisioning] board load failed', e);
  }

  // Per-portal build-out readiness (the fast-path gate): a portal whose master OPP is already fully
  // built out can be released in one click straight from this board — no cockpit trip. Bounded N (only
  // portals awaiting release), best-effort (readiness returns EMPTY.ready=false on any failure).
  const readyById = new Map<string, boolean>();
  await Promise.all(
    portals.map(async (p) => {
      if (!p.solId) return;
      try { readyById.set(p.id, (await getBuildReadiness(p.solId)).ready); } catch { /* not ready */ }
    }),
  );

  const now = Date.now();
  const overdueCount = portals.filter((p) => p.curationDueAt != null && new Date(p.curationDueAt).getTime() < now).length;
  const readyCount = portals.filter((p) => readyById.get(p.id)).length;

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900">Releases &amp; SLA</h1>
      <p className="text-sm text-gray-600 mt-1">
        Purchased portals awaiting expert release, sorted by the 72-hour curation SLA.{' '}
        {portals.length === 0 ? null : overdueCount > 0 ? (
          <span className="text-red-600 font-medium">{overdueCount} overdue.</span>
        ) : (
          <span className="text-green-600 font-medium">None overdue.</span>
        )}
        {readyCount > 0 && (
          <span className="text-gray-500">{' '}· <span className="font-medium text-indigo-600">{readyCount} ready to release now.</span></span>
        )}
      </p>

      {portals.length === 0 ? (
        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          No portals are awaiting release right now.
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {portals.map((p) => {
            const isOverdue = p.curationDueAt != null && new Date(p.curationDueAt).getTime() < now;
            const isReady = readyById.get(p.id) === true;
            return (
              <li key={p.id}>
                <div className={`rounded-lg border bg-white p-4 transition-shadow hover:shadow-sm ${isOverdue ? 'border-red-300' : 'border-gray-200'}`}>
                  <div className="flex items-start justify-between gap-4">
                    <Link href={`/admin/provisioning/${p.id}`} className="min-w-0 flex-1 group">
                      <p className="truncate font-semibold text-gray-900 group-hover:text-indigo-700">{p.oppTitle || p.label}</p>
                      <p className="mt-0.5 truncate text-sm text-gray-500">
                        {[p.agency, p.tenantName].filter(Boolean).join(' · ') || 'Unknown buyer'}
                      </p>
                    </Link>
                    <div className="shrink-0 flex flex-col items-end gap-2">
                      {p.curationDueAt ? (
                        <SlaCountdown dueAt={new Date(p.curationDueAt).toISOString()} />
                      ) : (
                        <span className="text-xs text-gray-400">No SLA set</span>
                      )}
                      {isReady ? (
                        <InstantReleaseButton portalId={p.id} label={p.oppTitle || p.label} />
                      ) : (
                        <Link href={`/admin/provisioning/${p.id}`} className="text-xs font-medium text-gray-500 hover:text-gray-700">
                          Curate &amp; release →
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
