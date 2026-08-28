import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { describeEvent } from '@/lib/event-labels';
import { listOpenTasksForActor } from '@/lib/tasks/tasks';
import { getCommandSeen, isNew } from '@/lib/command/seen';
import { CommandTabs, type CommandTabInput } from '@/components/command/command-tabs';
import { TodosPanel } from '@/components/tasks/todos-panel';
import PipelineCards from '@/components/portal/pipeline-cards';
import { listProjectsForActor } from '@/lib/projects/access';
import { ProcessesClient, type ProcessRow } from '../processes/processes-client';

/**
 * Tenant Command Center — the tabbed, count-badged "what needs me → act" console for a company,
 * the tenant-side twin of /admin/command. Four lanes: Opportunities (spotlight + builds) · To-dos ·
 * Workflows (live process instances) · Activity (admin-only event firehose). Reuses the SAME
 * <CommandTabs> shell + the real domain surfaces (PipelineCards, TaskQueue, ProcessesClient).
 *
 * Audience: tenant_admin+ — a base tenant_user's home is the cockpit (/dashboard). Descended
 * rfp-admins (shadow) and partner-managers (pin-up) run as tenant_admin-in-session, so they inherit
 * this view unchanged. docs/COMMAND_CENTER_DESIGN.md §3.3.
 */
export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<string, { label: string; cls: string }> = {
  outline: { label: 'Outline', cls: 'bg-gray-100 text-gray-600' },
  draft: { label: 'Drafting', cls: 'bg-amber-100 text-amber-800' },
  review: { label: 'In review', cls: 'bg-indigo-100 text-indigo-700' },
  final: { label: 'Final', cls: 'bg-emerald-100 text-emerald-700' },
  submitted: { label: 'Submitted', cls: 'bg-emerald-100 text-emerald-700' },
  archived: { label: 'Archived', cls: 'bg-gray-100 text-gray-500' },
};

interface InFlightProposal { id: string; title: string; stage: string; isLocked: boolean; updatedAt: string }

// Opportunities lane — the in-flight builds strip (proposals needing work) over the live
// matched-opportunity feed (PipelineCards, self-loading, with pin/purchase actions).
function OpportunitiesBody({
  proposals, tenantSlug, role, basePath,
}: { proposals: InFlightProposal[]; tenantSlug: string; role: Role; basePath: string }) {
  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">In-flight builds</h2>
        {proposals.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white p-5 text-center text-sm text-gray-500">
            No active builds yet. Pin an opportunity below, then start a build.
          </div>
        ) : (
          <ul className="divide-y divide-black/5 rounded-xl border border-gray-200 bg-white">
            {proposals.map((p) => {
              const st = STAGE_LABEL[p.stage] ?? { label: p.stage, cls: 'bg-gray-100 text-gray-600' };
              return (
                <li key={p.id}>
                  <Link href={`${basePath}/proposals/${p.id}`} className="flex items-center justify-between gap-3 min-h-11 px-4 py-2.5 hover:bg-black/5 active:bg-black/10 transition-colors">
                    <span className="min-w-0 flex items-center gap-2">
                      <span className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                      <span className="truncate text-sm font-medium text-gray-900">{p.title}</span>
                      {p.isLocked && <span className="shrink-0 text-[11px] text-gray-400">🔒</span>}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-indigo-600">Open →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section>
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">Matched opportunities</h2>
        <PipelineCards tenantSlug={tenantSlug} role={role} />
      </section>
    </div>
  );
}

interface ActivityItem { id: string; label: string; at: string }

// Activity lane — a compact recent-events feed (admin-only). The full filterable firehose lives at
// /activity; this is the glanceable "what happened lately" for the console.
/**
 * The Projects lane.
 *
 * One row per active project, and each says the ONE thing that would make somebody open it. A list
 * of names with no state is a list somebody has to click through to learn anything, which is the
 * opposite of what a command centre is for — so a project with nothing outstanding says so, in
 * quiet type, rather than being hidden.
 */
function ProjectsBody({
  rows, basePath,
}: {
  rows: Array<{ id: string; name: string; overdue: number; reviews: number; unaccepted: number }>;
  basePath: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600">
        No active projects. A won proposal raises a to-do to open one.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white text-sm">
      {rows.map((r) => {
        const flags = [
          r.overdue > 0 ? `${r.overdue} overdue` : null,
          r.reviews > 0 ? `${r.reviews} awaiting review` : null,
          r.unaccepted > 0 ? `${r.unaccepted} unaccepted` : null,
        ].filter(Boolean) as string[];
        return (
          // Stacked below `sm`, one line above it — the same shape as every other row on the
          // project surfaces, so the lane does not become the one place that behaves differently
          // on a phone.
          <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            <Link href={`${basePath}/projects/${r.id}`} className="min-w-0 truncate font-medium text-blue-700 hover:underline">
              {r.name}
            </Link>
            <span className="flex flex-wrap gap-1.5">
              {flags.length === 0
                ? <span className="text-xs text-gray-400">nothing outstanding</span>
                : flags.map((f) => (
                  <span
                    key={f}
                    className={`rounded px-1.5 py-0.5 text-[11px] ring-1 ring-inset ${
                      /overdue/.test(f)
                        ? 'bg-red-50 text-red-800 ring-red-600/30'
                        : 'bg-amber-50 text-amber-900 ring-amber-600/30'}`}
                  >
                    {f}
                  </span>
                ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ActivityBody({ items, basePath }: { items: ActivityItem[]; basePath: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      {items.length === 0 ? (
        <p className="text-sm text-gray-400">No recent activity yet — invites, member changes, and lifecycle events show here.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {items.map((e) => (
            <li key={e.id} className="py-2.5">
              <span className="block text-sm text-gray-700">{e.label}</span>
              <span className="text-xs text-gray-400">{e.at}</span>
            </li>
          ))}
        </ul>
      )}
      <Link href={`${basePath}/activity`} className="mt-3 inline-block text-xs font-medium text-blue-600 hover:text-blue-800">
        Open full Activity Stream →
      </Link>
    </div>
  );
}

export default async function TenantCommandCenterPage({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;

  const session = await auth();
  if (!session?.user) redirect('/login');
  const sessionUser = session.user as { id?: string; name?: string | null; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) redirect('/login?error=session');

  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) redirect('/portal');
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) redirect('/portal');
  enterTenant(tenantId); // RLS choke point — every query below is tenant-scoped

  // Command Center is the admin console: tenant_admin+ (a descended rfp-admin/partner-manager passes).
  // A base tenant_user's home is the cockpit; send them there.
  if (!hasRoleAtLeast(role, 'tenant_admin')) redirect(`/portal/${tenantSlug}/dashboard`);

  const basePath = `/portal/${tenantSlug}`;
  const firstName = (sessionUser.name ?? 'there').split(/[\s@]/)[0];

  // Small guarded count helper (postgres.js returns int8 as string → parseInt).
  const count = async (label: string, q: Promise<{ count: string }[]>): Promise<number> => {
    try { const [r] = await q; return parseInt(r?.count ?? '0', 10); }
    catch (e) { console.error(`[portal/command] ${label} count failed`, e); return 0; }
  };

  // ── Opportunities: pinned cards + in-flight builds ──
  const pinnedCards = await count('pinned', sql`
    SELECT COUNT(*)::text AS count FROM tenant_opportunity_cards
    WHERE tenant_id = ${tenantId} AND is_pinned = true
      AND lifecycle_status <> 'archived' AND archived_at IS NULL`);
  const activeProposalCount = await count('proposals', sql`
    SELECT COUNT(*)::text AS count FROM proposals
    WHERE tenant_id = ${tenantId} AND stage NOT IN ('archived','submitted')`);
  let proposals: InFlightProposal[] = [];
  try {
    proposals = await sql<InFlightProposal[]>`
      SELECT id, title, stage, is_locked, updated_at FROM proposals
      WHERE tenant_id = ${tenantId} AND stage NOT IN ('archived','submitted')
      ORDER BY updated_at DESC LIMIT 8`;
  } catch (e) {
    console.error('[portal/command] proposals query failed', e);
  }

  // ── To-dos: the actor's open queue (same query TaskQueue reads → badge never lies) ──
  let todoRows: { createdAt: string }[] = [];
  try { todoRows = await listOpenTasksForActor({ id: sessionUser.id!, role, tenantId }); }
  catch (e) { console.error('[portal/command] todos query failed', e); }
  const todosCount = todoRows.length;

  // ── Workflows: live process instances (reuse the /processes ledger rows verbatim) ──
  let processRows: ProcessRow[] | null = null;
  try {
    processRows = await sql<ProcessRow[]>`
      SELECT id, workflow_name, status, current_step, step_status,
             deadline, last_heartbeat_at, last_error, last_error_step,
             started_at, updated_at, created_at
      FROM process_instances
      WHERE tenant_id = ${tenantId}::uuid AND archived_at IS NULL
      ORDER BY updated_at DESC LIMIT 100`;
  } catch (e) {
    console.error('[portal/command] processes query failed', e);
    processRows = null; // null ≠ [] — surfaced as a load error, not "empty"
  }
  const ACTIVE = new Set(['running', 'paused', 'pending', 'retrying']);
  // Badge = the actionable instances (mostly paused HITL gates) — NOT running-only, or it reads empty.
  const activeInstances = (processRows ?? []).filter((r) => ACTIVE.has(r.status)).length;

  // ── Activity: recent events (admin-only lane) ──
  interface EventRow { id: string; namespace: string; type: string; phase: string; createdAt: string; payload: Record<string, unknown> }
  let recentEvents: EventRow[] = [];
  try {
    recentEvents = await sql<EventRow[]>`
      SELECT id, namespace, type, phase, created_at, payload
      FROM system_events WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC LIMIT 25`;
  } catch (e) {
    console.error('[portal/command] events query failed', e);
  }
  const activity: ActivityItem[] = recentEvents.map((evt) => ({
    id: evt.id,
    label: describeEvent({ namespace: evt.namespace, type: evt.type, phase: evt.phase, payload: evt.payload }),
    at: new Date(evt.createdAt).toLocaleString(),
  }));

  const oppsCount = pinnedCards + activeProposalCount;

  // ── Projects: the post-award half of a customer's life (migs 216-223) ──
  //
  // Scoped by `listProjectsForActor`, which is the same function the workspace uses — the roster
  // IS the access mechanism for an employee, so a lane built on a second query would be a second
  // opinion about who can see what. Each row carries the ONE thing that would make somebody open
  // it: what is overdue, what is waiting on a decision, what is unaccepted.
  type ProjectLaneRow = {
    id: string; name: string; status: string;
    overdue: number; reviews: number; unaccepted: number; updatedAt: string | null;
  };
  let projectRows: ProjectLaneRow[] = [];
  try {
    const mine = await listProjectsForActor({ userId: sessionUser.id!, role, tenantId });
    const active = mine.filter((p) => p.status !== 'closed');
    if (active.length) {
      const ids = active.map((p) => p.id);
      const [late, pendingReviews, unaccepted, touched] = await Promise.all([
        sql<{ projectId: string; n: number }[]>`
          SELECT project_id, count(*)::int AS n FROM project_milestones
           WHERE project_id = ANY(${ids}::uuid[]) AND tenant_id = ${tenantId}::uuid
             AND status = 'pending' AND forecast_date < CURRENT_DATE
           GROUP BY project_id`,
        sql<{ projectId: string; n: number }[]>`
          SELECT project_id, count(*)::int AS n FROM project_reviews
           WHERE project_id = ANY(${ids}::uuid[]) AND tenant_id = ${tenantId}::uuid
             AND status = 'pending'
           GROUP BY project_id`,
        sql<{ projectId: string; n: number }[]>`
          SELECT m.project_id, count(*)::int AS n FROM project_deliverables d
            JOIN project_milestones m ON m.id = d.milestone_id
           WHERE m.project_id = ANY(${ids}::uuid[]) AND d.tenant_id = ${tenantId}::uuid
             AND d.accepted_at IS NULL
           GROUP BY m.project_id`,
        sql<{ id: string; updatedAt: string }[]>`
          SELECT id, updated_at FROM projects
           WHERE id = ANY(${ids}::uuid[]) AND tenant_id = ${tenantId}::uuid`,
      ]);
      const by = (rows: { projectId: string; n: number }[]) =>
        new Map(rows.map((r) => [r.projectId, r.n]));
      const lateBy = by(late); const revBy = by(pendingReviews); const unBy = by(unaccepted);
      const touchedBy = new Map(touched.map((r) => [r.id, r.updatedAt]));
      projectRows = active.map((p) => ({
        id: p.id, name: p.name, status: p.status,
        overdue: lateBy.get(p.id) ?? 0,
        reviews: revBy.get(p.id) ?? 0,
        unaccepted: unBy.get(p.id) ?? 0,
        updatedAt: touchedBy.get(p.id) ?? null,
      }));
    }
  } catch (e) {
    console.error('[portal/command] project lane failed:', e);
  }
  // The BADGE counts what needs a person, not how many projects exist. A lane that reads "3"
  // because you are on three healthy projects is a lane that is always non-zero and therefore
  // never informative.
  const projectsCount = projectRows.reduce((n, r) => n + r.overdue + r.reviews, 0);

  // ── "New since you last looked" (mig 179): the newest item per lane (from what we already fetched)
  //    vs the per-tab watermark. First visit (no watermark) → no dots. Best-effort. ──
  const scope = `tenant:${tenantId}`;
  const seen = await getCommandSeen(sessionUser.id!, scope);
  const newestTodo = todoRows.reduce<string | Date | null>(
    (m, r) => (!m || new Date(r.createdAt).getTime() > new Date(m).getTime() ? r.createdAt : m),
    null,
  );
  const hasNew = {
    opp: isNew(seen, 'opp', proposals[0]?.updatedAt ?? null),
    todos: isNew(seen, 'todos', newestTodo),
    workflows: isNew(seen, 'workflows', (processRows ?? [])[0]?.updatedAt ?? null),
    activity: isNew(seen, 'activity', recentEvents[0]?.createdAt ?? null),
    projects: isNew(seen, 'projects', projectRows.reduce<string | null>(
      (m, r) => (r.updatedAt && (!m || new Date(r.updatedAt) > new Date(m)) ? r.updatedAt : m), null,
    )),
  };

  const tabs: CommandTabInput[] = [
    {
      key: 'opp', title: 'Opportunities', tone: 'action', count: oppsCount, hasNew: hasNew.opp,
      actions: [
        { label: '🔍 Browse spotlight', href: `${basePath}/cards` },
        { label: '📄 My builds', href: `${basePath}/portals` },
      ],
      body: <OpportunitiesBody proposals={proposals} tenantSlug={tenantSlug} role={role} basePath={basePath} />,
    },
    {
      key: 'todos', title: 'To-dos', tone: 'action', count: todosCount, hasNew: hasNew.todos,
      actions: [
        { label: '👥 Invite teammate', href: `${basePath}/team` },
      ],
      body: <TodosPanel tenantSlug={tenantSlug} canCompose />,
    },
    {
      key: 'workflows', title: 'Workflows', tone: 'default', count: activeInstances, hasNew: hasNew.workflows,
      actions: [
        // Real per-proposal starts only (locked decision — no generic launcher for tenants). Full-draft
        // mode vs Studio is chosen on the proposal itself, so both route to the build to pick one.
        { label: '📝 Run a draft', href: `${basePath}/proposals` },
        { label: '📨 New to-do', href: `${basePath}/todos` },
      ],
      body: (
        <ProcessesClient
          rows={processRows ?? []}
          loadError={processRows === null}
          canAdvance={hasRoleAtLeast(role, 'tenant_admin')}
          tenantSlug={tenantSlug}
        />
      ),
    },
    {
      key: 'projects', title: 'Projects', tone: projectsCount > 0 ? 'action' : 'default',
      count: projectsCount, hasNew: hasNew.projects,
      actions: [{ label: '📁 All projects', href: `${basePath}/projects` }],
      body: <ProjectsBody rows={projectRows} basePath={basePath} />,
    },
    {
      key: 'activity', title: 'Activity', tone: 'default', count: 0, hasNew: hasNew.activity,
      actions: [],
      body: <ActivityBody items={activity} basePath={basePath} />,
    },
  ];

  const actionable = oppsCount + todosCount + projectsCount;

  return (
    <div className="max-w-3xl mx-auto">
      <header className="mb-4">
        <h1 className="text-2xl font-bold">Command Center</h1>
        <p className="mt-1 text-sm text-gray-500">
          {actionable > 0
            ? <>Hi {firstName} — <span className="font-semibold text-amber-700">{actionable}</span> open across your lanes.</>
            : <>Hi {firstName} — you&apos;re all caught up. 🎉</>}
        </p>
      </header>
      <CommandTabs tabs={tabs} initialKey="opp" scope={scope} />
    </div>
  );
}
