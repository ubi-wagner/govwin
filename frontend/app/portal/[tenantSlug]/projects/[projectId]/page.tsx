import { Fragment } from 'react';
import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, enterTenant, sql } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { projectScope, listAssignees } from '@/lib/projects/access';
import { getProject, listSourceDocuments, readiness } from '@/lib/projects/project';
import { listClins } from '@/lib/projects/clins';
import { listMilestones, listDeliverables } from '@/lib/projects/milestones';
import { listMilestoneTasks } from '@/lib/projects/milestone-tasks';
import { listTaskAttachments } from '@/lib/projects/task-attachments';
import { listProjectComments } from '@/lib/projects/comments';
import { listProjectReviews } from '@/lib/projects/reviews';
import { listAcceptanceEvidence } from '@/lib/projects/evidence';
import { listProjectRisks } from '@/lib/projects/risks';
import { listModifications } from '@/lib/projects/modifications';
import { listInvoices, clinBilling, billableHours } from '@/lib/projects/invoices';
import { listCdrlItems } from '@/lib/projects/cdrl';
import { resolveProjectNotify, PROJECT_TRIGGERS } from '@/lib/projects/notify-policy';
import { TRIGGER_CATALOG } from '@/lib/automation/catalog';
import { listProjectMeetings } from '@/lib/projects/meetings';
import { CommentThread, type ThreadComment } from '@/components/projects/comment-thread';
import { ReviewPanel, type PanelReview } from '@/components/projects/review-panel';
import { EvidencePanel, type PanelEvidence } from '@/components/projects/evidence-panel';
import { RiskRegister, type RegisterRisk } from '@/components/projects/risk-register';
import { MeetingLog, type LogMeeting } from '@/components/projects/meeting-log';
import { ModificationLog, type LoggedModification } from '@/components/projects/modification-log';
import { InvoiceLedger, type LedgerInvoice, type LedgerClin, type LedgerUnbilled } from '@/components/projects/invoice-ledger';
import { CdrlRegister, type RegisterCdrl } from '@/components/projects/cdrl-register';
import { NotificationPolicy, type PolicyTrigger } from '@/components/projects/notification-policy';
import { provenanceFor, badgeFor } from '@/lib/projects/provenance';
import { rollup } from '@/lib/projects/rollup';
import { isoDate, daysBetween, varianceLabel } from '@/lib/projects/dates';
import { usd, spentOf } from '@/lib/projects/money';
import { DeliverableRow } from '@/components/projects/deliverable-row';
import { MilestoneChecklist } from '@/components/projects/milestone-checklist';
import { ProjectRoster } from '@/components/projects/project-roster';
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

  const [docs, clins, milestones, deliverables, tasks, taskFiles, comments, reviews, evidence, risks, meetings, modifications, invoices, billing, unbilled, cdrlItems, notifyPolicy, candidates, ready, assignees, measures] = await Promise.all([
    listSourceDocuments(tenantId, projectId),
    listClins(tenantId, projectId),
    listMilestones(tenantId, projectId),
    listDeliverables(tenantId, projectId),
    listMilestoneTasks(tenantId, projectId),
    // Every reference on the project in one read. Per-task fetches would turn a twenty-task
    // milestone into twenty round trips on a page that already renders them all.
    listTaskAttachments(tenantId, projectId),
    // One read for the whole conversation, bucketed below. A request per anchor would turn one
    // page into thirty.
    listProjectComments(tenantId, projectId),
    listProjectReviews(tenantId, projectId),
    listAcceptanceEvidence(tenantId, projectId),
    listProjectRisks(tenantId, projectId),
    listProjectMeetings(tenantId, projectId),
    listModifications(tenantId, projectId),
    listInvoices(tenantId, projectId),
    clinBilling(tenantId, projectId),
    billableHours(tenantId, projectId),
    listCdrlItems(tenantId, projectId),
    // The third level of the automation policy, resolved for each project trigger. Reading it here
    // rather than in the component keeps the page one round of queries, and keeps the resolver on
    // the server where the tenant policy lives.
    Promise.all(PROJECT_TRIGGERS.map(async (t) => {
      const resolved = await resolveProjectNotify(tenantId, projectId, t);
      const meta = TRIGGER_CATALOG.find((c) => c.scope === 'project' && c.triggerKey === t);
      return {
        trigger: t, label: meta?.label ?? t, help: meta?.help ?? '',
        deliveryStatus: meta?.deliveryStatus ?? 'preview', ...resolved,
      };
    })),
    // Candidates for the roster picker. A person adds someone the UI OFFERS; the route
    // re-checks membership, so this list is convenience, not the boundary.
    sql<{ id: string; email: string; name: string | null }[]>`
      SELECT u.id, u.email, u.name FROM users u
        JOIN user_memberships m ON m.user_id = u.id AND m.tenant_id = ${tenantId}::uuid
       WHERE m.status = 'active' AND u.is_active = true AND u.role <> 'partner_user'
       ORDER BY u.email`,
    readiness(tenantId, projectId),
    listAssignees(tenantId, projectId),
    rollup(tenantId, projectId),
  ]);

  const prov: Record<string, Awaited<ReturnType<typeof provenanceFor>>> = {};
  for (const c of clins) prov[c.id] = await provenanceFor(tenantId, 'project_clins', c.id);

  // Tasks by milestone — the checklist half of the construct. A milestone is a dated segment of
  // work; without its list, the page shows only the date.
  //
  // A `scope: 'project'` task belongs to NO milestone (mig 221), so it is separated out rather than
  // bucketed under a stand-in key. Filing standing work under a phase it does not belong to would
  // make it gate that phase on screen while gating nothing in the database.
  // Comments keyed by "<entityType>:<entityId>", so one map serves all four anchors and a thread
  // cannot be rendered under the wrong kind of row just because two ids collided.
  const threadKey = (t: string, id: string | null) => `${t}:${id ?? ''}`;
  const commentsByAnchor = new Map<string, ThreadComment[]>();
  for (const c of comments) {
    const k = threadKey(c.entityType, c.entityId);
    const list = commentsByAnchor.get(k) ?? [];
    list.push({
      id: c.id, entityType: c.entityType, entityId: c.entityId, parentId: c.parentId,
      body: c.body, authorUserId: c.authorUserId,
      authorEmail: c.authorEmail ?? null, authorName: c.authorName ?? null,
      mentions: c.mentions ?? [],
      resolvedAt: c.resolvedAt ? String(c.resolvedAt) : null,
      editedAt: c.editedAt ? String(c.editedAt) : null,
      createdAt: c.createdAt ? String(c.createdAt) : null,
    });
    commentsByAnchor.set(k, list);
  }
  const threadFor = (t: string, id: string | null) => commentsByAnchor.get(threadKey(t, id)) ?? [];

  // Reviews are passed WHOLE to each panel, which picks its own: the component already applies the
  // "only the latest counts" rule that the server's acceptance gate applies, and duplicating that
  // selection here would be two places deciding what a standing objection is.
  const panelReviews: PanelReview[] = reviews.map((r) => ({
    id: r.id, entityType: r.entityType, entityId: r.entityId, requestedBy: r.requestedBy,
    reviewerUserId: r.reviewerUserId, reviewerRole: r.reviewerRole,
    reviewerEmail: r.reviewerEmail ?? null, note: r.note,
    dueOn: isoDate(r.dueOn), status: r.status, reason: r.reason,
    decidedAt: r.decidedAt ? String(r.decidedAt) : null,
    createdAt: r.createdAt ? String(r.createdAt) : null,
  }));
  const memberOptions = assignees.map((a) => ({ id: a.userId, email: a.email ?? a.userId }));

  const panelEvidence: PanelEvidence[] = evidence.map((e) => ({
    id: e.id, deliverableId: e.deliverableId, kind: e.kind,
    customerName: e.customerName, customerRole: e.customerRole,
    occurredOn: isoDate(e.occurredOn), filename: e.filename, note: e.note,
    uploadedByEmail: e.uploadedByEmail ?? null,
  }));

  const filesByTask = new Map<string, { id: string; filename: string }[]>();
  for (const f of taskFiles) {
    const list = filesByTask.get(f.taskId) ?? [];
    list.push({ id: f.id, filename: f.filename });
    filesByTask.set(f.taskId, list);
  }
  // ONE mapper for both lists. Two copies of this shape is how the standing list quietly stops
  // showing a field the milestone list gained.
  const asChecklistTask = (t: (typeof tasks)[number]) => ({
    id: t.id, title: t.title, detail: t.detail,
    assigneeUserId: t.assigneeUserId ?? null,
    assigneeEmail: t.assigneeEmail ?? null, assigneeRole: t.assigneeRole,
    dueDate: isoDate(t.dueDate), estimatedCompletion: isoDate(t.estimatedCompletion),
    status: t.status, blockedReason: t.blockedReason,
    attachments: filesByTask.get(t.id) ?? [],
  });

  const tasksByMilestone = new Map<string, typeof tasks>();
  const projectTasks: typeof tasks = [];
  for (const t of tasks) {
    if (!t.milestoneId) { projectTasks.push(t); continue; }
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
        <ProjectRoster
          assignees={assignees.map((a) => ({ userId: a.userId, email: a.email, name: a.name }))}
          candidates={candidates}
          basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
          canManage={canAccept}
        />
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
                    tasks={(tasksByMilestone.get(m.id) ?? []).map(asChecklistTask)}
                    members={assignees.map((a) => ({ id: a.userId, email: a.email ?? a.userId }))}
                    basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
                    canManage={canAccept}
                    milestoneMet={m.status === 'met'}
                  />
                  <CommentThread
                    entityType="milestone"
                    entityId={m.id}
                    label={m.title}
                    comments={threadFor('milestone', m.id)}
                    basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
                  />
                  {items.length > 0 && (
                    <ul className="mt-3 space-y-2 text-sm">
                      {items.map((d) => (
                        // `DeliverableRow` IS the <li>, so the thread cannot be its sibling inside
                        // a <ul> — a fragment keyed on the deliverable keeps both under one child
                        // without putting a <div> where the HTML says a list item belongs.
                        <Fragment key={d.id}>
                          <DeliverableRow
                            deliverable={{
                              id: d.id, title: d.title, filename: d.filename,
                              storageKey: d.storageKey,
                              acceptedAt: d.acceptedAt ? String(d.acceptedAt) : null,
                              documentId: d.documentId ?? null,
                              documentTitle: d.documentTitle ?? null,
                            }}
                            basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
                            canAccept={canAccept}
                            tenantSlug={tenantSlug}
                          />
                          {/* A deliverable is where acceptance is argued about, so it is where the
                              argument should live — not in an email nobody else on the project
                              can read. */}
                          <li className="ml-4 list-none">
                            {/* The review sits with the deliverable it gates, above the
                                conversation: a standing rejection is the thing somebody has to act
                                on, and burying it under a comment thread would make it optional. */}
                            <ReviewPanel
                              entityType="deliverable"
                              entityId={d.id}
                              label={d.title}
                              reviews={panelReviews}
                              members={memberOptions}
                              basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
                              canDecide={canAccept}
                            />
                            {/* The customer's act, filed by us — and rendered as exactly that.
                                `acceptedByEmail` is the person in THIS product; the evidence names
                                who they say signed. Two facts, side by side, never merged. */}
                            <EvidencePanel
                              deliverableId={d.id}
                              label={d.title}
                              evidence={panelEvidence}
                              basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
                              canFile={canAccept}
                              acceptedByEmail={d.acceptedAt ? (d.acceptedByEmail ?? null) : null}
                            />
                            <CommentThread
                              entityType="deliverable"
                              entityId={d.id}
                              label={d.title}
                              comments={threadFor('deliverable', d.id)}
                              basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
                            />
                          </li>
                        </Fragment>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── STANDING WORK ────────────────────────────────────────────────────────────────────
          Tasks that belong to no phase (mig 221). Rendered as its own list rather than folded
          into a milestone, because that is what it is: it gates CLOSE-OUT, not any one phase,
          and showing it under a milestone would imply a gate the database does not enforce.
          The section is shown whenever there is standing work OR someone can add some — an
          empty list with no way to add is a section that only ever says "nothing here". */}
      {(projectTasks.length > 0 || canAccept) && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
            Standing work
          </h2>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">
              Not tied to a phase. It does not gate a milestone — it gates close-out.
            </p>
            <MilestoneChecklist
              milestoneId={null}
              tasks={projectTasks.map(asChecklistTask)}
              members={assignees.map((a) => ({ id: a.userId, email: a.email ?? a.userId }))}
              basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
              canManage={canAccept}
              milestoneMet={false}
            />
          </div>
        </section>
      )}

      {/* ── THE AMENDMENT HISTORY ────────────────────────────────────────────────────────────
          Directly under the CLIN table, because it is the only thing that moves it. A person
          reading a funded amount and wondering why it is not the number in the award needs the
          answer on the same screen, not on a tab. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Contract modifications
        </h2>
        <ModificationLog
          modifications={modifications as unknown as LoggedModification[]}
          clins={clins.map((c) => ({ id: c.id, clinNumber: c.clinNumber, title: c.title }))}
          documents={docs.map((d) => ({ id: d.id, filename: d.filename ?? d.kind }))}
          basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
          canAmend={canAccept}
        />
      </section>

      {/* ── THE DATA REQUIREMENTS ────────────────────────────────────────────────────────────
          Between the contract (CLINs, modifications) and the money (billing), because that is
          where it sits in fact: a CDRL is a contractual obligation, and on many contracts
          delivering it is what makes an invoice payable. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Data requirements
        </h2>
        <CdrlRegister
          items={cdrlItems as unknown as RegisterCdrl[]}
          clins={clins.map((c) => ({ id: c.id, clinNumber: c.clinNumber }))}
          basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
          canManage={canAccept}
        />
      </section>

      {/* ── BILLING ──────────────────────────────────────────────────────────────────────────
          Directly under the modifications, because the ceiling it reports IS the CLIN's funded
          amount and a signed mod is the only thing that moves it. Reading them apart is how
          somebody comes to wonder why the remaining figure changed. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Billing and invoices
        </h2>
        <InvoiceLedger
          invoices={invoices as unknown as LedgerInvoice[]}
          billing={billing as unknown as LedgerClin[]}
          unbilled={unbilled as unknown as LedgerUnbilled[]}
          basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
          canBill={canAccept}
        />
      </section>

      {/* ── THE REGISTER ─────────────────────────────────────────────────────────────────────
          Above the discussion, because a high-scoring open risk is the thing a person opening
          this page most needs to see, and below the plan, because it is about the plan. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Risks and issues
        </h2>
        <RiskRegister
          risks={risks.map((r): RegisterRisk => ({
            id: r.id, title: r.title, detail: r.detail, kind: r.kind, status: r.status,
            probability: r.probability, impact: r.impact, score: r.score,
            ownerEmail: r.ownerEmail ?? null, mitigation: r.mitigation,
            contingency: r.contingency, reviewOn: isoDate(r.reviewOn),
            closedNote: r.closedNote,
          }))}
          members={memberOptions}
          basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
          canClose={canAccept}
        />
      </section>

      {/* ── WHAT WAS AGREED ──────────────────────────────────────────────────────────────────
          Below the register, because a meeting is where most of what is on the register got
          decided, and above the discussion, because the discussion is about all of it. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Meetings and action items
        </h2>
        <MeetingLog
          meetings={meetings.map((m): LogMeeting => ({
            id: m.id, title: m.title, heldOn: isoDate(m.heldOn),
            attendees: m.attendees ?? [], documentId: m.documentId,
            actionItems: m.actionItems ?? 0, actionItemsDone: m.actionItemsDone ?? 0,
          }))}
          members={memberOptions}
          basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
          tenantSlug={tenantSlug}
          canRaise={canAccept}
        />
      </section>

      {/* ── REMINDERS ────────────────────────────────────────────────────────────────────────
          At the foot, because it is a SETTING and not work. A person comes here once, when the
          default cadence is wrong for this contract. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Reminders
        </h2>
        <NotificationPolicy
          triggers={notifyPolicy as unknown as PolicyTrigger[]}
          basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
          canEdit={canAccept}
        />
      </section>

      {/* ── THE PROJECT-LEVEL CONVERSATION ───────────────────────────────────────────────────
          Everything that is about the contract rather than about one phase of it. It is a
          section rather than a footer because a project with an unanswered question on it is
          not in the same state as one without, and that should be visible without scrolling
          to the bottom. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Discussion
        </h2>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500">
            About the project as a whole. Type <code>@</code> and someone&rsquo;s email to notify
            them &mdash; they have to be on this project to be reachable.
          </p>
          <CommentThread
            entityType="project"
            entityId={null}
            comments={threadFor('project', null)}
            basePath={`/api/portal/${tenantSlug}/projects/${projectId}`}
          />
        </div>
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
