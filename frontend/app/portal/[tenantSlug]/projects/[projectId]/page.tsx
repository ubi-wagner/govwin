import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { projectScope, listAssignees } from '@/lib/projects/access';
import { getProject, listSourceDocuments, readiness } from '@/lib/projects/project';
import { listClins } from '@/lib/projects/clins';
import { listMilestones, listDeliverables } from '@/lib/projects/milestones';
import { listMilestoneTasks } from '@/lib/projects/milestone-tasks';
import { provenanceFor, badgeFor } from '@/lib/projects/provenance';
import { rollup } from '@/lib/projects/rollup';
import { isoDate, daysBetween, varianceLabel } from '@/lib/projects/dates';
import { usd, spentOf } from '@/lib/projects/money';
import { DeliverableRow } from '@/components/projects/deliverable-row';
import { MilestoneChecklist } from '@/components/projects/milestone-checklist';
import { canAssign } from '@/lib/projects/access';

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
 * A project workspace.
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
export default async function ProjectPage({
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
  if (projectScope({ role, userId: su.id }).kind === 'none') redirect(`/portal/${tenantSlug}/dashboard`);

  enterTenant(tenantId);

  const actor = { userId: su.id, role, tenantId };
  // Accept is tenant_admin+; upload is open to any assigned employee (see DeliverableRow).
  const canAccept = canAssign(role);
  // `getProject` runs the assignment check. Unreachable answers 404 rather than 403 — a 403 would
  // confirm the project exists to someone with no business knowing.
  const project = await getProject(actor, projectId);
  if (!project) notFound();

  const [docs, clins, milestones, deliverables, tasks, ready, assignees, measures] = await Promise.all([
    listSourceDocuments(tenantId, projectId),
    listClins(tenantId, projectId),
    listMilestones(tenantId, projectId),
    listDeliverables(tenantId, projectId),
    listMilestoneTasks(tenantId, projectId),
    readiness(tenantId, projectId),
    listAssignees(tenantId, projectId),
    rollup(tenantId, projectId),
  ]);

  const prov: Record<string, Awaited<ReturnType<typeof provenanceFor>>> = {};
  for (const c of clins) prov[c.id] = await provenanceFor(tenantId, 'project_clins', c.id);

  // Tasks by milestone — the checklist half of the construct. A milestone is a dated segment of
  // work; without its list, the page shows only the date.
  const tasksByMilestone = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const list = tasksByMilestone.get(t.milestoneId) ?? [];
    list.push(t);
    tasksByMilestone.set(t.milestoneId, list);
  }

  const byMilestone = new Map<string, typeof deliverables>();
  for (const d of deliverables) {
    const list = byMilestone.get(d.milestoneId) ?? [];
    list.push(d);
    byMilestone.set(d.milestoneId, list);
  }

  return (
    <div className="p-6 md:p-8">
      <div className="mb-6">
        <Link href={`/portal/${tenantSlug}/projects`} className="text-sm text-blue-700 hover:underline">
          ← Projects
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
            detail={spentOf(measures.project.actualCost, measures.project.plannedCost)
              ?? 'nothing planned yet'}
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
                        <div className="tabular-nums text-gray-900">{usd(c.fundedAmount) ?? '—'}</div>
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

                  {/* The segment. A start and an end, because a milestone is a stretch of work and
                      not an instant — and because the chain of them IS the plan. */}
                  {(isoDate(m.startsOn) || isoDate(m.forecastDate)) && (
                    <div className="mt-1 text-xs text-gray-500 tabular-nums">
                      {isoDate(m.startsOn) ?? '—'} → {isoDate(m.forecastDate) ?? '—'}
                    </div>
                  )}

                  {/* The completion RECORD. "met" on its own is unreadable six months later. */}
                  {m.status === 'met' && (m.completionNote || m.completionMetrics) && (
                    <div className="mt-2 rounded border border-green-200 bg-green-50 p-2 text-xs text-green-900">
                      {m.completionNote && <div>{m.completionNote}</div>}
                      {m.completionMetrics && (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 tabular-nums">
                          {Object.entries(m.completionMetrics).map(([k, v]) => (
                            <span key={k}>
                              <span className="text-green-700">{k}</span>{' '}
                              <span className="font-medium">{String(v)}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <MilestoneChecklist
                    milestoneId={m.id}
                    tasks={(tasksByMilestone.get(m.id) ?? []).map((t) => ({
                      id: t.id, title: t.title, detail: t.detail,
                      assigneeEmail: t.assigneeEmail ?? null, assigneeRole: t.assigneeRole,
                      dueDate: isoDate(t.dueDate), status: t.status,
                      blockedReason: t.blockedReason,
                    }))}
                    basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
                    canManage={canAccept}
                    milestoneMet={m.status === 'met'}
                  />
                  {items.length > 0 && (
                    <ul className="mt-3 space-y-2 text-sm">
                      {items.map((d) => (
                        <DeliverableRow
                          key={d.id}
                          deliverable={{
                            id: d.id, title: d.title, filename: d.filename,
                            storageKey: d.storageKey,
                            acceptedAt: d.acceptedAt ? String(d.acceptedAt) : null,
                          }}
                          basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
                          canAccept={canAccept}
                        />
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
