import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { deliveryScope, listAssignees } from '@/lib/delivery/access';
import { getProject, listSourceDocuments, readiness } from '@/lib/delivery/projects';
import { listClins } from '@/lib/delivery/clins';
import { listMilestones, listDeliverables } from '@/lib/delivery/milestones';
import { provenanceFor, badgeFor } from '@/lib/delivery/provenance';
import { rollup } from '@/lib/delivery/rollup';
import { isoDate, daysBetween, varianceLabel } from '@/lib/delivery/dates';

export const dynamic = 'force-dynamic';

/** A measure, or an honest "not measured". Never a confident zero. */
function Measure({ label, value, detail }: { label: string; value: number | null; detail: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-gray-900">
        {value === null
          ? <span className="text-lg font-normal text-gray-400">not measured</span>
          : `${value}%`}
      </div>
      <div className="mt-1 text-xs text-gray-500">{detail}</div>
    </div>
  );
}

const BADGE_TONE: Record<string, string> = {
  sourced: 'bg-green-50 text-green-800 ring-green-600/20',
  entered: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  elsewhere: 'bg-amber-50 text-amber-900 ring-amber-600/30',
  unverified: 'bg-red-50 text-red-800 ring-red-600/20',
};

/**
 * A delivery workspace.
 *
 * ── WHAT THIS PAGE REFUSES TO DO ─────────────────────────────────────────────────────────────
 * It does not show a single "percent complete". Three measures sit side by side, and a measure with
 * no denominator reads "not measured" rather than 0% — a project with nothing planned is not nought
 * percent spent, and rendering it as one states a measurement nobody took.
 *
 * Every CLIN field carries a provenance badge. A value with no recorded source reads **Unverified**,
 * not neutral: silence about where a number came from is the same claim as "we made it up". A
 * citation with no value reads **Set elsewhere** — the contract saying where the answer lives is a
 * finding, not a blank.
 */
export default async function DeliveryProjectPage({
  params,
}: {
  params: Promise<{ tenantSlug: string; projectId: string }>;
}) {
  const { tenantSlug, projectId } = await params;
  const session = await auth();
  if (!session?.user) redirect('/login');
  const su = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(su.role) ? su.role : null;
  if (!role || !su.id) redirect('/login?error=session');
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(su.id, role, tenantId))) redirect('/portal');
  if (deliveryScope({ role, userId: su.id }).kind === 'none') redirect(`/portal/${tenantSlug}/dashboard`);

  enterTenant(tenantId);

  const actor = { userId: su.id, role, tenantId };
  // `getProject` runs the assignment check. Unreachable answers 404 rather than 403 — a 403 would
  // confirm the project exists to someone with no business knowing.
  const project = await getProject(actor, projectId);
  if (!project) notFound();

  const [docs, clins, milestones, deliverables, ready, assignees, measures] = await Promise.all([
    listSourceDocuments(tenantId, projectId),
    listClins(tenantId, projectId),
    listMilestones(tenantId, projectId),
    listDeliverables(tenantId, projectId),
    readiness(tenantId, projectId),
    listAssignees(tenantId, projectId),
    rollup(tenantId, projectId),
  ]);

  const prov: Record<string, Awaited<ReturnType<typeof provenanceFor>>> = {};
  for (const c of clins) prov[c.id] = await provenanceFor(tenantId, 'delivery_clins', c.id);

  const byMilestone = new Map<string, typeof deliverables>();
  for (const d of deliverables) {
    const list = byMilestone.get(d.milestoneId) ?? [];
    list.push(d);
    byMilestone.set(d.milestoneId, list);
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <Link href={`/portal/${tenantSlug}/delivery`} className="text-sm text-blue-700 hover:underline">
          ← Delivery
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">{project.name}</h1>
        <p className="mt-1 text-sm text-gray-600">
          {project.status}
          {project.baselinedAt
            ? ` · baselined ${new Date(project.baselinedAt).toLocaleDateString()}`
            : ' · not baselined'}
          {assignees.length ? ` · ${assignees.length} assigned` : ''}
        </p>
      </div>

      {!ready.canBaseline && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Upload {ready.missing.join(' and ')} before baselining
          </p>
          <p className="mt-1 text-sm text-amber-800">
            The baseline is what variance is measured against, so it has to be measured against the
            signed documents — not a working copy that stayed editable after submission.
          </p>
        </div>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Progress</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Measure
            label="Cost"
            value={measures.project.costPct}
            detail={measures.project.plannedCost
              ? `${measures.project.actualCost} of ${measures.project.plannedCost} spent`
              : 'nothing planned yet'}
          />
          <Measure
            label="Schedule"
            value={measures.project.schedulePct}
            detail={measures.project.nodesWithDates
              ? `${measures.project.nodesWithDates} task(s) with dates, weighted by duration`
              : 'no task carries both dates'}
          />
          <Measure
            label="Deliverables"
            value={measures.project.deliverablesPct}
            detail={measures.project.deliverablesTotal
              ? `${measures.project.deliverablesAccepted} of ${measures.project.deliverablesTotal} accepted`
              : 'none declared'}
          />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          Shown side by side and never averaged — budget spent against schedule elapsed is the
          comparison that carries the signal.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Contract line items
        </h2>
        {clins.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
            No CLINs entered yet. Each one can carry a citation back to the executed contract.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">CLIN</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="px-4 py-3 font-medium">Period of performance</th>
                  <th className="px-4 py-3 font-medium">Funded</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clins.map((c) => {
                  const p = prov[c.id] ?? {};
                  const popBadge = badgeFor(p.pop_end, Boolean(c.popEnd));
                  const fundedBadge = badgeFor(p.funded_amount, c.fundedAmount !== null);
                  return (
                    <tr key={c.id}>
                      <td className="px-4 py-3 font-mono text-gray-900">{c.clinNumber}</td>
                      <td className="px-4 py-3 text-gray-900">{c.title}</td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900">
                          {isoDate(c.popStart) && isoDate(c.popEnd)
                            ? `${isoDate(c.popStart)} → ${isoDate(c.popEnd)}`
                            : '—'}
                        </div>
                        <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${BADGE_TONE[popBadge.tone]}`}>
                          {popBadge.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="tabular-nums text-gray-900">{c.fundedAmount ?? '—'}</div>
                        <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${BADGE_TONE[fundedBadge.tone]}`}>
                          {fundedBadge.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Milestones and deliverables
        </h2>
        {milestones.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
            No milestones yet.
          </p>
        ) : (
          <div className="space-y-3">
            {milestones.map((m) => {
              const items = byMilestone.get(m.id) ?? [];
              // `daysBetween` handles the Date-not-string case. This line used to slice a `Date`'s
              // string form to ten characters and parse it, which produced NaN — and rendered as
              // "NaN days early against baseline" on a live page that every lens scored clean.
              const vl = varianceLabel(daysBetween(m.baselineDate, m.forecastDate));
              return (
                <div key={m.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium text-gray-900">{m.title}</span>
                    <span className="text-xs text-gray-500">
                      {m.status}
                      {vl && (
                        <span className={vl.late ? 'ml-2 text-red-700' : 'ml-2 text-green-700'}>
                          {vl.text}
                        </span>
                      )}
                    </span>
                  </div>
                  {items.length > 0 && (
                    <ul className="mt-3 space-y-1 text-sm">
                      {items.map((d) => (
                        <li key={d.id} className="flex flex-wrap items-center gap-2">
                          <span className="text-gray-900">{d.title}</span>
                          {d.acceptedAt ? (
                            <span className="rounded bg-green-50 px-1.5 py-0.5 text-[11px] text-green-800 ring-1 ring-inset ring-green-600/20">
                              accepted
                            </span>
                          ) : d.storageKey ? (
                            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-900 ring-1 ring-inset ring-amber-600/30">
                              uploaded — not accepted
                            </span>
                          ) : (
                            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 ring-1 ring-inset ring-gray-500/20">
                              nothing uploaded
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Contract artifacts
        </h2>
        {docs.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
            Nothing uploaded. The executed contract and the proposal as submitted are what everything
            here is measured against.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <span className="text-gray-900">{d.filename}</span>
                <span className="text-xs text-gray-500">
                  {d.kind === 'executed_contract' ? 'Executed contract' : 'Proposal as submitted'}
                  {' · '}
                  {new Date(d.uploadedAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
