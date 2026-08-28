/**
 * Three measures of progress, reported side by side and never blended.
 *
 * ── WHY THERE IS NO "PERCENT COMPLETE" IN THIS FILE ──────────────────────────────────────────
 * Sixty percent of budget spent against forty percent of schedule elapsed is the single most
 * important thing a project manager can see. Averaging them to "50%" destroys exactly that signal
 * — and it destroys it silently, because the number that comes out still looks like an answer.
 *
 * The house rule this follows is the same one behind *a confident zero reads as a measurement*: a
 * number that hides its own disagreement is worse than two numbers that argue. So `rollup()`
 * returns three independent percentages and a fourth reading (variance), and there is deliberately
 * no function here that combines them.
 *
 * ── AND WHY A MEASURE WITH NO DENOMINATOR IS `null`, NOT `0` ─────────────────────────────────
 * A project with nothing planned is not 0% spent. A CLIN with no deliverables is not 0% delivered.
 * Rendering either as `0%` states a measurement that was never taken, and a reader cannot tell it
 * apart from real, alarming progress-of-zero.
 *
 * `null` says "not measured"; `0` says "measured, and it is zero". The UI has to render them
 * differently, which is the point.
 *
 * ── THE EFFECTIVE CLIN ───────────────────────────────────────────────────────────────────────
 * A WBS node carries `clin_id` OR inherits it from the nearest ancestor that does — a plan is
 * written as "CLIN 0001 → design → wireframes", and nobody re-tags every leaf. The recursive CTE
 * below resolves that once; aggregating on the raw column instead would silently drop every child
 * node from its CLIN's cost, and the total would still look plausible.
 */
import { sql } from '@/lib/db';

export interface Measures {
  /** Σ actual_cost / Σ planned_cost. `null` when nothing is planned. */
  costPct: number | null;
  /** Elapsed against planned_start…planned_end, weighted by each node's duration. `null` when
   *  no node carries both dates. */
  schedulePct: number | null;
  /** Accepted / total deliverables. `null` when there are none. */
  deliverablesPct: number | null;

  // The raw counts, so a reader can see what each percentage was computed FROM. A percentage
  // whose denominator is invisible is a percentage nobody can check.
  plannedCost: string | null;
  /** Other direct costs entered on the WBS node — travel, materials. */
  otherDirectCost: string;
  /** APPROVED labour, summed from project_time_entries (mig 227). */
  labourCost: string;
  labourHours: string;
  /** `otherDirectCost + labourCost`. Both halves are reported beside it, because a number a
   *  reader cannot decompose is a number they cannot check. */
  actualCost: string;
  deliverablesAccepted: number;
  deliverablesTotal: number;
  nodesWithDates: number;
}

export interface ClinRollup extends Measures {
  clinId: string | null;
  clinNumber: string | null;
  title: string | null;
  fundedAmount: string | null;
}

export interface ProjectRollup {
  project: Measures;
  clins: ClinRollup[];
  /** Days late (positive) or early (negative) per milestone, against the immutable baseline. */
  variance: Array<{ id: string; title: string; varianceDays: number | null; status: string }>;
}

/**
 * `a / b` as a percentage, or **null when the denominator says nothing was measured**.
 *
 * Exported for `__tests__/projects-rollup-measures.test.ts`. The live drive
 * (`scripts/verify-project-rollup.mjs`) proves the SQL, but it needs a database and CI runs
 * vitest — and this rule is the one most likely to be "tidied" into returning 0 by someone who
 * reads a null percentage as a bug.
 */
export function pct(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * The rollup. One query for the WBS (cost + schedule) and one for deliverables, because they hang
 * off different parents — deliverables belong to milestones, not to WBS nodes — and forcing them
 * into a single join produces a cartesian product that silently multiplies the cost totals.
 */
export async function rollup(tenantId: string, projectId: string): Promise<ProjectRollup> {
  try {
    // ── WBS: cost and schedule, per effective CLIN ──────────────────────────────────────────
    //
    // `effective_clin` walks up `parent_id` to the nearest ancestor carrying a CLIN. Schedule is
    // weighted by DURATION: a two-day task at 100% and a two-hundred-day task at 0% is not 50%
    // done, and an unweighted node-count average says it is.
    const wbs = await sql<Array<{
      clinId: string | null;
      plannedCost: string | null;
      otherDirectCost: string | null;
      labourCost: string | null;
      labourHours: string | null;
      actualCost: string | null;
      elapsedDays: string | null;
      totalDays: string | null;
      nodesWithDates: number;
    }>>`
      WITH RECURSIVE resolved AS (
        SELECT n.id, n.parent_id, n.clin_id, n.planned_cost, n.actual_cost,
               n.planned_start, n.planned_end, n.clin_id AS effective_clin
          FROM project_wbs_nodes n
         WHERE n.project_id = ${projectId}::uuid AND n.tenant_id = ${tenantId}::uuid
           AND n.parent_id IS NULL
        UNION ALL
        SELECT c.id, c.parent_id, c.clin_id, c.planned_cost, c.actual_cost,
               c.planned_start, c.planned_end,
               COALESCE(c.clin_id, r.effective_clin) AS effective_clin
          FROM project_wbs_nodes c
          JOIN resolved r ON r.id = c.parent_id
         WHERE c.project_id = ${projectId}::uuid AND c.tenant_id = ${tenantId}::uuid
      ),
      -- APPROVED labour per node (mig 227). Only approved: hours are what a customer is billed
      -- for, and "somebody typed it" is not the same claim as "a manager checked it". Aggregated
      -- FIRST and joined once, because joining the entries into resolved would multiply every
      -- node's planned_cost by its number of timesheet rows -- a total that still looks plausible.
      labour AS (
        SELECT wbs_node_id, SUM(cost) AS labour_cost, SUM(hours) AS labour_hours
          FROM project_time_entries
         WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
           AND approved_at IS NOT NULL
         GROUP BY wbs_node_id
      )
      SELECT effective_clin AS clin_id,
             SUM(planned_cost)                                   AS planned_cost,
             SUM(actual_cost)                                    AS other_direct_cost,
             COALESCE(SUM(l.labour_cost), 0)                     AS labour_cost,
             COALESCE(SUM(l.labour_hours), 0)                    AS labour_hours,
             SUM(actual_cost) + COALESCE(SUM(l.labour_cost), 0)  AS actual_cost,
             -- Elapsed, clamped into the node's own window: a task that has not started
             -- contributes 0, one that is past its end contributes its whole duration, and
             -- nothing contributes more than it is worth.
             SUM(
               CASE WHEN planned_start IS NULL OR planned_end IS NULL THEN 0
                    ELSE GREATEST(0, LEAST(
                      (planned_end - planned_start) + 1,
                      (CURRENT_DATE - planned_start) + 1
                    )) END
             )::numeric                                          AS elapsed_days,
             SUM(
               CASE WHEN planned_start IS NULL OR planned_end IS NULL THEN 0
                    ELSE (planned_end - planned_start) + 1 END
             )::numeric                                          AS total_days,
             COUNT(*) FILTER (
               WHERE planned_start IS NOT NULL AND planned_end IS NOT NULL
             )::int                                              AS nodes_with_dates
        FROM resolved
        LEFT JOIN labour l ON l.wbs_node_id = resolved.id
       GROUP BY effective_clin`;

    // ── Deliverables, per effective CLIN via the milestone ───────────────────────────────────
    //
    // A milestone carries its own `clin_id`; when it does not, it inherits through its WBS node.
    // Separate query, because a deliverable is not a WBS node — joining them in one statement
    // multiplies every cost row by the number of deliverables under it.
    const deliverables = await sql<Array<{
      clinId: string | null; accepted: number; total: number;
    }>>`
      SELECT COALESCE(m.clin_id, n.clin_id) AS clin_id,
             COUNT(*) FILTER (WHERE d.accepted_at IS NOT NULL)::int AS accepted,
             COUNT(*)::int                                          AS total
        FROM project_deliverables d
        JOIN project_milestones m ON m.id = d.milestone_id
        LEFT JOIN project_wbs_nodes n ON n.id = m.wbs_node_id
       WHERE m.project_id = ${projectId}::uuid AND d.tenant_id = ${tenantId}::uuid
       GROUP BY COALESCE(m.clin_id, n.clin_id)`;

    const clinRows = await sql<Array<{
      id: string; clinNumber: string; title: string; fundedAmount: string | null;
    }>>`
      SELECT id, clin_number, title, funded_amount FROM project_clins
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY sort_index, clin_number`;

    const variance = await sql<Array<{
      id: string; title: string; varianceDays: number | null; status: string;
    }>>`
      SELECT id, title, status,
             CASE WHEN baseline_date IS NULL OR forecast_date IS NULL THEN NULL
                  ELSE (forecast_date - baseline_date)::int END AS variance_days
        FROM project_milestones
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY sort_index, baseline_date NULLS LAST`;

    const wbsBy = new Map(wbs.map((r) => [r.clinId, r]));
    const delBy = new Map(deliverables.map((r) => [r.clinId, r]));

    const measuresFor = (
      w?: (typeof wbs)[number], d?: (typeof deliverables)[number],
    ): Measures => {
      const planned = w?.plannedCost != null ? Number(w.plannedCost) : 0;
      const actual = w?.actualCost != null ? Number(w.actualCost) : 0;
      const elapsed = w?.elapsedDays != null ? Number(w.elapsedDays) : 0;
      const total = w?.totalDays != null ? Number(w.totalDays) : 0;
      return {
        costPct: pct(actual, planned),
        schedulePct: pct(elapsed, total),
        deliverablesPct: d ? pct(d.accepted, d.total) : null,
        plannedCost: w?.plannedCost ?? null,
        otherDirectCost: w?.otherDirectCost ?? '0',
        labourCost: w?.labourCost ?? '0',
        labourHours: w?.labourHours ?? '0',
        actualCost: w?.actualCost ?? '0',
        deliverablesAccepted: d?.accepted ?? 0,
        deliverablesTotal: d?.total ?? 0,
        nodesWithDates: w?.nodesWithDates ?? 0,
      };
    };

    const clins: ClinRollup[] = clinRows.map((c) => ({
      clinId: c.id,
      clinNumber: c.clinNumber,
      title: c.title,
      fundedAmount: c.fundedAmount,
      ...measuresFor(wbsBy.get(c.id), delBy.get(c.id)),
    }));

    // Work that belongs to no CLIN is REPORTED, not folded into the project total silently. An
    // unassigned row is usually a plan someone has not finished writing, and hiding it inside a
    // total is how it stays unfinished.
    const unassigned = wbsBy.get(null) || delBy.get(null);
    if (unassigned) {
      clins.push({
        clinId: null, clinNumber: null, title: 'Not assigned to a CLIN', fundedAmount: null,
        ...measuresFor(wbsBy.get(null), delBy.get(null)),
      });
    }

    // The project total is computed from the ROWS, not from an average of the CLIN percentages.
    // Averaging percentages weights a $2,000 CLIN the same as a $2,000,000 one.
    const sum = (f: (r: (typeof wbs)[number]) => number) => wbs.reduce((a, r) => a + f(r), 0);
    const plannedAll = sum((r) => Number(r.plannedCost ?? 0));
    const actualAll = sum((r) => Number(r.actualCost ?? 0));
    const elapsedAll = sum((r) => Number(r.elapsedDays ?? 0));
    const totalAll = sum((r) => Number(r.totalDays ?? 0));
    const acceptedAll = deliverables.reduce((a, r) => a + r.accepted, 0);
    const deliverablesAll = deliverables.reduce((a, r) => a + r.total, 0);

    return {
      project: {
        costPct: pct(actualAll, plannedAll),
        schedulePct: pct(elapsedAll, totalAll),
        deliverablesPct: pct(acceptedAll, deliverablesAll),
        plannedCost: plannedAll ? String(plannedAll) : null,
        otherDirectCost: String(sum((r) => Number(r.otherDirectCost ?? 0))),
        labourCost: String(sum((r) => Number(r.labourCost ?? 0))),
        labourHours: String(sum((r) => Number(r.labourHours ?? 0))),
        actualCost: String(actualAll),
        deliverablesAccepted: acceptedAll,
        deliverablesTotal: deliverablesAll,
        nodesWithDates: wbs.reduce((a, r) => a + (r.nodesWithDates ?? 0), 0),
      },
      clins,
      variance,
    };
  } catch (err) {
    console.error('[projects/rollup] rollup failed:', err);
    // An EMPTY rollup, with every measure null — "not measured", never a confident zero. A caught
    // error that returned zeroes would render as a project with no spend and no progress, which is
    // a claim, and a false one.
    return {
      project: {
        costPct: null, schedulePct: null, deliverablesPct: null,
        plannedCost: null, otherDirectCost: '0', labourCost: '0', labourHours: '0', actualCost: '0',
        deliverablesAccepted: 0, deliverablesTotal: 0, nodesWithDates: 0,
      },
      clins: [],
      variance: [],
    };
  }
}
