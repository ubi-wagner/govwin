import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
// Admin cross-tenant console page — reads span tenants, so use the owner (BYPASSRLS) pool.
// (docs/RLS_CUTOVER.md: admin/CMS reads on RLS-forced tables MUST use sqlBypass.)
import { sqlBypass } from '@/lib/db';
import { runInTenant } from '@/lib/tenant-context';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import { rollup, type ProjectRollup } from '@/lib/projects/rollup';

export const dynamic = 'force-dynamic';

/**
 * /admin/projects — the post-award half of the business, seen across every tenant.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────
 * An rfp_admin could see every solicitation, every card, every build and every purchase, and then
 * lost sight of the customer at exactly the moment the money started: once a contract was awarded
 * and a project opened, the only way to look at it was to descend into one tenant at a time and
 * know which one to pick. Projects shipped with a tenant workspace and no platform view at all —
 * `capability-reconciliation` classes that as UNSURFACED, and it is the second half of the
 * customer's life (docs/PROJECT_MANAGEMENT_DESIGN.md).
 *
 * ── READ-ONLY, ON PURPOSE ────────────────────────────────────────────────────────────────────
 * There is not one write verb here, and that is a design decision rather than an unfinished
 * feature. An rfp_admin has NO ambient cross-tenant authority (CLAUDE.md · Roles): the way they
 * act on a customer's project is to DESCEND into that tenant's shadow account, where every
 * refusal, every capability check and every audit row is the tenant's own. A console that could
 * edit a milestone from up here would be a second, quieter path into a customer's contract, with
 * different rules from the one the customer sees. So each row deep-links through the existing
 * `/api/enter` descent to the tenant's own workspace, and nothing else.
 *
 * ── THREE MEASURES, SIDE BY SIDE, NEVER BLENDED ──────────────────────────────────────────────
 * Cost, duration-weighted schedule and deliverables come from `lib/projects/rollup.ts` — the SAME
 * function the tenant workspace calls, not a second implementation that could drift from it. A
 * measure with no denominator renders "not measured", never a confident 0%: that rule is the
 * whole reason `pct()` returns null, and a platform roll-up that quietly averaged nulls to zero
 * would be the most convincing wrong number on the platform.
 *
 * `rollup()` reads through the context-aware `sql`, so it is called inside `runInTenant` per
 * project. That keeps the shared implementation honest under RLS instead of forking a bypass copy.
 */

type Row = {
  id: string;
  name: string;
  status: string;
  baselinedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  contractTitle: string | null;
  milestonesTotal: number;
  milestonesMet: number;
  openTasks: number;
  assignees: number;
};

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * A percentage, or the honest absence of one. `null` means no denominator — not zero.
 *
 * No inner caption: the column header already says which measure this is, and repeating it in
 * every cell cost enough width to push the row's primary action ("Open in <tenant>") off the
 * right-hand edge at 1440px. The table scrolls, so nothing was unreachable — but a primary action
 * you have to go looking for is the defect this tree found on the documents page, and it is not
 * worth paying for a label the header already carries.
 */
function Measure({ value }: { value: number | null }) {
  return value === null
    ? <span className="text-xs text-gray-400 italic" title="No denominator — nothing to measure this against yet. Not 0%.">not measured</span>
    : <span className="text-sm font-medium tabular-nums text-gray-900">{value}%</span>;
}

export default async function AdminProjectsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role as Role | undefined;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) redirect('/login');

  let rows: Row[] = [];
  let loadError: string | null = null;
  try {
    rows = await sqlBypass<Row[]>`
      SELECT p.id, p.name, p.status, p.baselined_at, p.closed_at, p.created_at,
             p.tenant_id, t.slug AS tenant_slug, t.name AS tenant_name,
             c.title AS contract_title,
             (SELECT count(*)::int FROM project_milestones m
               WHERE m.project_id = p.id) AS milestones_total,
             (SELECT count(*)::int FROM project_milestones m
               WHERE m.project_id = p.id AND m.met_at IS NOT NULL) AS milestones_met,
             -- Open work, from the checklist that is the source of truth — not the projected
             -- ToDos, which follow it and would double-count anything mid-sweep.
             (SELECT count(*)::int FROM project_milestone_tasks k
               WHERE k.project_id = p.id AND k.status = 'open') AS open_tasks,
             (SELECT count(*)::int FROM project_assignments a
               WHERE a.project_id = p.id) AS assignees
        FROM projects p
        JOIN tenants t ON t.id = p.tenant_id
        LEFT JOIN contracts c ON c.id = p.contract_id
       -- No archived_at filter: the projects table deliberately has no such column. Archive ACTIONS live
       -- on exactly three entities — a portal, a library atom, a tenant — and a project is not one
       -- of them (docs/ARCHIVABLE_CONTRACT.md). Filtering on a column that does not exist raised
       -- 42703, the catch below turned that into an error banner, and this console showed no
       -- post-award work at all.
       ORDER BY (p.status = 'closed'), p.created_at DESC`;
  } catch (e) {
    // Said out loud on the page. A console that renders an empty table when its query failed
    // tells an operator there is no post-award work, which is the opposite of the truth (B131).
    console.error('[admin/projects] project list query failed:', e);
    loadError = 'The project list could not be loaded.';
  }

  // The rollup per project, through the tenant's own context so the shared function stays honest.
  const measures = new Map<string, ProjectRollup['project'] | null>();
  for (const r of rows) {
    try {
      const roll = await runInTenant(r.tenantId, () => rollup(r.tenantId, r.id));
      measures.set(r.id, roll.project);
    } catch (e) {
      console.error(`[admin/projects] rollup failed for ${r.id}:`, e);
      measures.set(r.id, null);   // rendered as "—", never as zeroes
    }
  }

  const active = rows.filter((r) => r.status !== 'closed').length;
  const closed = rows.length - active;

  return (
    <div className="p-6 max-w-[1500px]">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Projects</h1>
        <p className="text-sm text-gray-500 mt-1">
          Every customer&apos;s post-award execution, across all tenants — {active} active
          {closed > 0 ? ` · ${closed} closed out` : ''}. Read-only: open a project in its own
          company&apos;s workspace to act on it.
        </p>
      </div>

      {loadError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {loadError}
        </div>
      )}

      {!loadError && rows.length === 0 && (
        <div className="rounded border border-gray-200 bg-white p-6 text-sm text-gray-500">
          No projects yet. One is created after an award — <code>contract:started</code> raises a
          ToDo, and a tenant_admin opens the project from it.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Project</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Baseline</th>
                <th className="px-3 py-2 font-medium">Milestones</th>
                <th className="px-3 py-2 font-medium">Open work</th>
                <th className="px-3 py-2 font-medium">Cost</th>
                <th className="px-3 py-2 font-medium">Schedule</th>
                <th className="px-3 py-2 font-medium">Deliverables</th>
                <th className="px-3 py-2 font-medium">Team</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const m = measures.get(r.id) ?? null;
                return (
                  <tr key={r.id} data-project-id={r.id}
                      className="border-t border-gray-100 align-top hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{r.tenantName}</div>
                      <div className="text-xs text-gray-400">{r.tenantSlug}</div>
                    </td>
                    <td className="px-3 py-2 max-w-xs">
                      {/* The row's primary action IS its title. It used to be a button in a
                          trailing column, which put the only way to act on a project past the
                          right-hand edge at 1440px — reachable by scrolling, but the same shape as
                          the clipped primary action this tree found on the documents page. */}
                      <Link
                        href={`/api/enter?slug=${encodeURIComponent(r.tenantSlug)}&next=${encodeURIComponent(`/portal/${r.tenantSlug}/projects/${r.id}`)}`}
                        className="block font-medium text-blue-700 hover:underline truncate"
                        title={`${r.name} — open in ${r.tenantSlug}'s own workspace`}
                      >{r.name}</Link>
                      {r.contractTitle && (
                        <div className="text-xs text-gray-400 truncate" title={r.contractTitle}>
                          {r.contractTitle}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-1.5 py-0.5 text-xs ${
                        r.status === 'closed' ? 'bg-gray-100 text-gray-600' : 'bg-emerald-50 text-emerald-700'
                      }`}>{r.status}</span>
                      {r.closedAt && (
                        <div className="mt-0.5 text-[11px] text-gray-400 tabular-nums">{iso(r.closedAt)}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {/* Frozen once, by trigger. "Not baselined" is a real state, not a blank. */}
                      {r.baselinedAt
                        ? <span className="text-gray-700" title="Frozen — migration 216's trigger refuses to move it">{iso(r.baselinedAt)}</span>
                        : <span className="text-amber-700">not baselined</span>}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums text-gray-700">
                      {r.milestonesMet} / {r.milestonesTotal}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {r.openTasks > 0
                        ? <span className="text-gray-900">{r.openTasks}</span>
                        : <span className="text-gray-300">0</span>}
                    </td>
                    <td className="px-3 py-2"><Measure value={m?.costPct ?? null} /></td>
                    <td className="px-3 py-2"><Measure value={m?.schedulePct ?? null} /></td>
                    <td className="px-3 py-2">
                      <Measure value={m?.deliverablesPct ?? null} />
                      {m && (
                        <span className="ml-1 text-[10px] text-gray-400 tabular-nums">
                          {m.deliverablesAccepted}/{m.deliverablesTotal}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {r.assignees > 0
                        ? <span className="text-gray-700">{r.assignees}</span>
                        : <span className="text-amber-700" title="Nobody is assigned — no employee can open this project">none</span>}
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
