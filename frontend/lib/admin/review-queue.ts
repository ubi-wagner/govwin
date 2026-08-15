/**
 * The admin Review Queue — the single "what needs my attention" aggregation behind the Command
 * Center. It fuses the three attention sources that today live on separate pages — the scout
 * candidate queue (scout_findings), the curation state-machine (curated_solicitations by status),
 * and open amendments (solicitation_amendments) — into ONE prioritized feed, ordered by "decisions
 * you must make" first. The workflow ToDo inbox is rendered by the existing TaskQueue component
 * alongside this (one query, one component), so it is intentionally not re-queried here.
 *
 * Admin/platform read: uses sqlBypass (the owner pool) — these are platform-scope tables and the
 * admin legitimately sees every tenant's items (docs/RLS_CUTOVER.md). Each source is wrapped so one
 * failing query degrades to an empty section, never a blank Command Center. camelCase reads.
 */
import { sqlBypass } from '@/lib/db';
import { taskHref } from '@/lib/tasks/completers';

export type QueueTone = 'action' | 'progress' | 'info';

export interface QueueItem {
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  meta?: string;
}

export interface QueueSection {
  key: string;
  title: string;
  /** action = a decision you owe; progress = work in flight; info = ambient. Drives color + order. */
  tone: QueueTone;
  count: number;
  /** Where the section's "see all" goes. */
  href: string;
  /** Top few items (most recent), for the at-a-glance feed. */
  items: QueueItem[];
}

export interface ReviewQueue {
  sections: QueueSection[];
  /** Sum of the `action`-tone counts — the true "needs a decision" badge for the nav/header. */
  actionable: number;
}

const ITEM_LIMIT = 6;

// Run a source query; on failure degrade to an empty plain array (never a blank Command Center).
// Spreads the postgres RowList into a plain T[] so the fallback `[]` type-checks.
async function safeRows<T>(p: Promise<readonly T[]>): Promise<T[]> {
  try { return [...(await p)]; } catch (e) { console.error('[review-queue] source failed:', e); return []; }
}

function solTitle(r: { solicitationTitle: string | null; solicitationNumber: string | null }): string {
  return r.solicitationTitle || r.solicitationNumber || 'Untitled solicitation';
}

/**
 * Build the prioritized review queue. Ordered so the decisions the admin owes surface first:
 * approve → release → amendments → new scout finds → new RFPs to claim, then work-in-flight, then ambient.
 */
export async function getReviewQueue(): Promise<ReviewQueue> {
  // ── curated_solicitations, bucketed by state ──
  const curatedRows = await safeRows(sqlBypass<Array<{
    id: string; status: string; solicitationTitle: string | null; solicitationNumber: string | null;
    createdAt: string;
  }>>`
    SELECT id, status, solicitation_title AS "solicitationTitle", solicitation_number AS "solicitationNumber",
           created_at AS "createdAt"
    FROM curated_solicitations
    WHERE status IN ('new','claimed','curation_in_progress','review_requested','approved')
    ORDER BY updated_at DESC
  `);
  const byStatus = (statuses: string[]) => curatedRows.filter((r) => statuses.includes(r.status));
  const toItems = (rows: typeof curatedRows): QueueItem[] =>
    rows.slice(0, ITEM_LIMIT).map((r) => ({
      id: r.id, title: solTitle(r),
      subtitle: r.solicitationNumber && r.solicitationTitle ? r.solicitationNumber : undefined,
      href: `/admin/rfp-curation/${r.id}`,
    }));

  const reviewRequested = byStatus(['review_requested']);
  const approved = byStatus(['approved']);
  const newRfps = byStatus(['new']);
  const inCuration = byStatus(['claimed', 'curation_in_progress']);

  // ── scout candidates awaiting classification/release ──
  const scoutRows = await safeRows(sqlBypass<Array<{
    id: string; title: string | null; classification: string | null; similarityScore: number | null;
  }>>`
    SELECT id, title, classification, similarity_score AS "similarityScore"
    FROM scout_findings
    WHERE status IN ('new','reviewed')
    ORDER BY discovered_at DESC
  `);

  // ── amendments detected, awaiting confirm→fan-out ──
  const amendRows = await safeRows(sqlBypass<Array<{
    id: string; solicitationId: string; label: string | null; severity: string | null;
  }>>`
    SELECT id, solicitation_id AS "solicitationId", label, severity
    FROM solicitation_amendments
    WHERE status = 'detected'
    ORDER BY detected_at DESC
  `);

  const sections: QueueSection[] = [
    {
      key: 'approve', title: 'Awaiting your approval', tone: 'action',
      count: reviewRequested.length, href: '/admin/rfp-curation', items: toItems(reviewRequested),
    },
    {
      key: 'release', title: 'Approved — ready to release', tone: 'action',
      count: approved.length, href: '/admin/rfp-curation', items: toItems(approved),
    },
    {
      key: 'amendments', title: 'Amendments to confirm', tone: 'action',
      count: amendRows.length, href: '/admin/rfp-curation',
      items: amendRows.slice(0, ITEM_LIMIT).map((r) => ({
        id: r.id, title: r.label || 'Amendment',
        subtitle: r.severity ? `${r.severity} severity` : undefined,
        href: `/admin/rfp-curation/${r.solicitationId}`,
      })),
    },
    {
      key: 'scout', title: 'New scout finds to triage', tone: 'action',
      count: scoutRows.length, href: '/admin/scouts',
      items: scoutRows.slice(0, ITEM_LIMIT).map((r) => ({
        id: r.id, title: r.title || 'Untitled finding',
        subtitle: r.classification ? r.classification.toUpperCase() : undefined,
        href: '/admin/scouts',
        meta: r.similarityScore != null ? `sim ${r.similarityScore.toFixed(2)}` : undefined,
      })),
    },
    {
      key: 'claim', title: 'New RFPs to claim', tone: 'action',
      count: newRfps.length, href: '/admin/rfp-curation', items: toItems(newRfps),
    },
    {
      key: 'in_curation', title: 'In curation', tone: 'progress',
      count: inCuration.length, href: '/admin/rfp-curation', items: toItems(inCuration),
    },
  ];

  const actionable = sections.filter((s) => s.tone === 'action').reduce((n, s) => n + s.count, 0);
  return { sections, actionable };
}

// ── Tabbed Command Center sources (Phase 1) ────────────────────────────────────────────────
// The three lanes beyond Opportunities. Admin/all-tenant reads on the bypass pool
// (docs/COMMAND_CENTER_DESIGN.md §3.1). Each degrades to empty on failure.

export interface TenantTodo {
  id: string;
  title: string;
  taskType: string;
  tenantName: string;
  tenantSlug: string;
  dueAt: string | null;
  /** The role-aware descend link into the tenant to act (portal entity, or the tenant's todos). */
  href: string;
}

/**
 * The cross-tenant TENANT-SURFACED to-dos — workflow ToDos assigned INSIDE a tenant (a tenant-role
 * assignee) that an admin acts on by DESCENDING into that tenant (shadow). The admin task feed never
 * shows these (they're not admin-assigned), so this is the one genuinely-new source. Navigational
 * only: the row descends into the tenant; completion happens there (docs/COMMAND_CENTER_DESIGN.md §5).
 */
export async function getTenantSurfacedTodos(): Promise<{ items: TenantTodo[]; count: number }> {
  const rows = await safeRows(sqlBypass<Array<{
    id: string; title: string | null; taskType: string; tenantSlug: string; tenantName: string;
    entityType: string | null; entityId: string | null; dueAt: string | null;
  }>>`
    SELECT tk.id, tk.title, tk.task_type AS "taskType", ten.slug AS "tenantSlug", ten.name AS "tenantName",
           tk.entity_type AS "entityType", tk.entity_id AS "entityId", tk.due_at AS "dueAt"
    FROM tasks tk
    JOIN tenants ten ON ten.id = tk.tenant_id
    WHERE tk.tenant_id IS NOT NULL
      AND tk.assignee_role IN ('tenant_admin','tenant_user','partner_user')
      AND tk.status IN ('open','in_progress')
      AND ten.archived_at IS NULL
    ORDER BY tk.due_at ASC NULLS LAST, tk.created_at ASC
    LIMIT 100
  `);
  const items: TenantTodo[] = rows.map((r) => ({
    id: r.id, title: r.title || 'Untitled to-do', taskType: r.taskType,
    tenantName: r.tenantName, tenantSlug: r.tenantSlug, dueAt: r.dueAt,
    href: taskHref({ tenantSlug: r.tenantSlug, entityType: r.entityType, entityId: r.entityId })
          ?? `/portal/${r.tenantSlug}/todos`,
  }));
  return { items, count: items.length };
}

/** Admin-tab badge count — the admin-bucket ToDos the /api/admin/tasks feed renders (same predicate). */
export async function getAdminTabCount(): Promise<number> {
  const [row] = await safeRows(sqlBypass<Array<{ n: number }>>`
    SELECT count(*)::int AS n FROM tasks
    WHERE assignee_role IN ('rfp_admin','master_admin') AND status IN ('open','in_progress')`);
  return row?.n ?? 0;
}

export interface SystemItem { id: string; title: string; subtitle: string; href: string; }

/**
 * System lane — pipeline instances that need attention (status='failed'). The honest v1 System
 * signal; a failed-workflow→to-do hook (docs/COMMAND_CENTER_DESIGN.md §7 phase 4) can enrich it later.
 */
export async function getSystemItems(): Promise<{ items: SystemItem[]; count: number }> {
  const rows = await safeRows(sqlBypass<Array<{
    id: string; workflowName: string; lastError: string | null; tenantName: string | null;
  }>>`
    SELECT pi.id, pi.workflow_name AS "workflowName", pi.last_error AS "lastError", ten.name AS "tenantName"
    FROM process_instances pi
    LEFT JOIN tenants ten ON ten.id = pi.tenant_id
    WHERE pi.status = 'failed' AND pi.archived_at IS NULL
    ORDER BY pi.updated_at DESC
    LIMIT 50
  `);
  const items: SystemItem[] = rows.map((r) => ({
    id: r.id, title: `${r.workflowName} — failed`,
    subtitle: [r.tenantName, r.lastError].filter(Boolean).join(' · ').slice(0, 90) || 'needs attention',
    href: '/admin/workflows',
  }));
  return { items, count: items.length };
}

/**
 * The newest item timestamp per admin CC lane — drives the "new since you last looked" dot (mig 179).
 * Predicates mirror each lane's count query exactly, so the dot and the badge agree. Each guarded →
 * a failing source just contributes null (no dot), never breaks the page. Cross-tenant → sqlBypass.
 */
export async function getAdminTabNewest(): Promise<{ opp: string | null; admin: string | null; tenant: string | null; system: string | null }> {
  const one = async (p: Promise<Array<{ ts: Date | string | null }>>): Promise<string | null> => {
    try {
      const [r] = await p;
      const v = r?.ts;
      return v == null ? null : v instanceof Date ? v.toISOString() : String(v);
    } catch { return null; }
  };
  const [scout, curated, amend, admin, tenant, system] = await Promise.all([
    one(sqlBypass`SELECT max(created_at) AS ts FROM scout_findings WHERE status IN ('new','reviewed')`),
    one(sqlBypass`SELECT max(created_at) AS ts FROM curated_solicitations WHERE status IN ('new','claimed','curation_in_progress','review_requested','approved')`),
    one(sqlBypass`SELECT max(created_at) AS ts FROM solicitation_amendments WHERE status = 'detected'`),
    one(sqlBypass`SELECT max(created_at) AS ts FROM tasks WHERE assignee_role IN ('rfp_admin','master_admin') AND status IN ('open','in_progress')`),
    one(sqlBypass`SELECT max(created_at) AS ts FROM tasks WHERE tenant_id IS NOT NULL AND assignee_role IN ('tenant_admin','tenant_user','partner_user') AND status IN ('open','in_progress')`),
    one(sqlBypass`SELECT max(updated_at) AS ts FROM process_instances WHERE status = 'failed' AND archived_at IS NULL`),
  ]);
  // opp lane = the newest across its three sources (ISO strings sort chronologically).
  const opp = [scout, curated, amend].filter(Boolean).sort().pop() ?? null;
  return { opp, admin, tenant, system };
}
