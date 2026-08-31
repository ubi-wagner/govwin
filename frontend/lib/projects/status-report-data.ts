/**
 * Gathering what a status report says.
 *
 * Separate from `status-report.ts` on purpose: the BUILDER is pure and testable against fixtures,
 * and this is the part that talks to the database. Merging them would make every assertion about
 * the report's wording require a live cluster, which is how a document's rules end up untested.
 *
 * Nothing here computes anything. Every figure is read from a function that already owns it —
 * `rollup()`, `clinBilling()`, the risk register — because a report that recomputed its own numbers
 * would be a second implementation, and the two would disagree eventually, in a document a customer
 * is holding.
 */
import { sql } from '@/lib/db';
import { rollup } from './rollup';
import { clinBilling } from './invoices';
import { listProjectRisks } from './risks';
import type { StatusReportInput } from './status-report';

export async function statusReportInput(
  tenantId: string,
  projectId: string,
  frame: { title: string; projectName: string; periodStart: string | null; periodEnd: string | null; asAt: string },
): Promise<StatusReportInput> {
  const [measures, billing, risks, taskCounts, upcoming] = await Promise.all([
    rollup(tenantId, projectId),
    clinBilling(tenantId, projectId),
    listProjectRisks(tenantId, projectId),

    // The checklist, counted by state. `::int` in SQL — postgres.js returns int8 as a STRING, and
    // `"3" + 1` is "31" in a report a customer reads.
    sql<{ done: number; open: number; blocked: number }[]>`
      SELECT count(*) FILTER (WHERE status = 'done')::int    AS done,
             count(*) FILTER (WHERE status = 'open')::int    AS open,
             count(*) FILTER (WHERE status = 'blocked')::int AS blocked
        FROM project_milestone_tasks
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid`,

    // What is still owed. `submitted_at IS NULL` rather than `accepted_at IS NULL`: the question a
    // customer asks is what has REACHED them, and a deliverable accepted internally but never sent
    // is outstanding from where they sit.
    sql<Array<{ title: string; requiredBy: string | null; milestone: string | null; sent: boolean }>>`
      SELECT d.title, d.required_by, m.title AS milestone,
             (d.submitted_at IS NOT NULL) AS sent
        FROM project_deliverables d
        JOIN project_milestones m ON m.id = d.milestone_id
       WHERE m.project_id = ${projectId}::uuid AND d.tenant_id = ${tenantId}::uuid
         AND d.submitted_at IS NULL
       ORDER BY d.required_by NULLS LAST, d.sort_index`,
  ]);

  const counts = taskCounts[0] ?? { done: 0, open: 0, blocked: 0 };

  return {
    ...frame,
    rollup: measures,
    billing,
    risks: risks.map((r) => ({
      title: r.title, kind: r.kind, status: r.status, score: r.score, mitigation: r.mitigation,
    })),
    tasksDone: counts.done,
    tasksOpen: counts.open,
    tasksBlocked: counts.blocked,
    upcoming,
  };
}
