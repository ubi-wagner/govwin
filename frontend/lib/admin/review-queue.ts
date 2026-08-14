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
