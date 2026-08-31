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
 * ── THE MILESTONE IS THE WBS ELEMENT (mig 228) ───────────────────────────────────────────────
 * There is no separate node tree, and so no recursive CTE resolving an inherited CLIN: a project is
 * the portal, the WBS **is** the milestone list, and each milestone carries tasks and deliverables.
 * The whole of that resolution logic went away, which is what collapsing a parallel structure is
 * supposed to feel like.
 *
 * TWO CLIN LINKS, and they answer different questions:
 *
 *   `project_milestones.clin_id`    which line item this month's WORK is under — CLIN 0002 having
 *                                   twelve monthly milestones is this column. Cost groups by it.
 *   `project_deliverables.clin_id`  which contractual ITEM a deliverable satisfies. Deliverable
 *                                   counts group by it.
 *
 * They usually agree and are still not the same claim: a milestone under CLIN 0001 can produce an
 * artefact that satisfies CLIN 0002, and a single column could not say so.
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
  /**
   * What was promised at baseline — frozen, and refused thereafter by migration 216's trigger
   * (the column arrived in mig 229). Reported BESIDE `plannedCost` rather than replacing it,
   * because they answer different questions: burn is against the current plan, and whether the
   * plan still matches the promise is the distance between these two. `null` before baselining.
   */
  baselineCost: string | null;
  /** Other direct costs entered on the milestone — travel, materials. */
  otherDirectCost: string;
  /** APPROVED labour, summed from project_time_entries (migs 227–228). */
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
 * The rollup. One query for cost and schedule and one for deliverables — kept apart because a
 * milestone has many of each, and joining both in one statement multiplies every milestone's
 * `planned_cost` by its deliverable count while the total still looks plausible.
 */
export async function rollup(tenantId: string, projectId: string): Promise<ProjectRollup> {
  try {
    // ── Cost and schedule, per CLIN, from the MILESTONES ────────────────────────────────────
    //
    // Flat: milestones do not nest, so there is nothing to resolve. Schedule is weighted by
    // DURATION — a two-day milestone at 100% and a two-hundred-day one at 0% is not 50% done, and
    // an unweighted count says it is.
    const wbs = await sql<Array<{
      clinId: string | null;
      plannedCost: string | null;
      baselineCost: string | null;
      otherDirectCost: string | null;
      labourCost: string | null;
      labourHours: string | null;
      actualCost: string | null;
      elapsedDays: string | null;
      totalDays: string | null;
      nodesWithDates: number;
    }>>`
      WITH labour AS (
        -- APPROVED labour per milestone (migs 227-228). Only approved: hours are what a customer
        -- is billed for, and "somebody typed it" is not "a manager checked it". Aggregated FIRST
        -- and joined once — joining the entries directly would multiply each milestone's
        -- planned_cost by its number of timesheet rows, and the total would still look plausible.
        SELECT milestone_id, SUM(cost) AS labour_cost, SUM(hours) AS labour_hours
          FROM project_time_entries
         WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
           AND approved_at IS NOT NULL
         GROUP BY milestone_id
      )
      SELECT m.clin_id                                             AS clin_id,
             SUM(m.planned_cost)                                   AS planned_cost,
             SUM(m.baseline_cost)                                  AS baseline_cost,
             SUM(m.actual_cost)                                    AS other_direct_cost,
             COALESCE(SUM(l.labour_cost), 0)                       AS labour_cost,
             COALESCE(SUM(l.labour_hours), 0)                      AS labour_hours,
             SUM(m.actual_cost) + COALESCE(SUM(l.labour_cost), 0)  AS actual_cost,
             -- Elapsed, clamped into each milestone's own window: one that has not started
             -- contributes 0, one past its end contributes its whole duration, and nothing
             -- contributes more than it is worth.
             SUM(
               CASE WHEN m.starts_on IS NULL OR m.forecast_date IS NULL THEN 0
                    ELSE GREATEST(0, LEAST(
                      (m.forecast_date - m.starts_on) + 1,
                      (CURRENT_DATE - m.starts_on) + 1
                    )) END
             )::numeric                                            AS elapsed_days,
             SUM(
               CASE WHEN m.starts_on IS NULL OR m.forecast_date IS NULL THEN 0
                    ELSE (m.forecast_date - m.starts_on) + 1 END
             )::numeric                                            AS total_days,
             COUNT(*) FILTER (
               WHERE m.starts_on IS NOT NULL AND m.forecast_date IS NOT NULL
             )::int                                                AS nodes_with_dates
        FROM project_milestones m
        LEFT JOIN labour l ON l.milestone_id = m.id
       WHERE m.project_id = ${projectId}::uuid AND m.tenant_id = ${tenantId}::uuid
       GROUP BY m.clin_id`;

    const deliverables = await sql<Array<{
      clinId: string | null; accepted: number; total: number;
    }>>`
      -- By the DELIVERABLE's own CLIN, falling back to its milestone's. The deliverable names the
      -- contractual item; the milestone names the line item its work sits under. A milestone under
      -- CLIN 0001 producing a CLIN 0002 artefact is counted where the contract counts it.
      SELECT COALESCE(d.clin_id, m.clin_id) AS clin_id,
             COUNT(*) FILTER (WHERE d.accepted_at IS NOT NULL)::int AS accepted,
             COUNT(*)::int                                          AS total
        FROM project_deliverables d
        JOIN project_milestones m ON m.id = d.milestone_id
       WHERE m.project_id = ${projectId}::uuid AND d.tenant_id = ${tenantId}::uuid
       GROUP BY COALESCE(d.clin_id, m.clin_id)`;

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
        baselineCost: w?.baselineCost ?? null,
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
    // "No baseline" and "a baseline of zero" are different answers, and `baselineAll ? … : null`
    // cannot tell them apart. Ask whether any row HAS one, rather than whether the total is truthy.
    const baselineAll = sum((r) => Number(r.baselineCost ?? 0));
    const anyBaseline = wbs.some((r) => r.baselineCost != null);
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
        baselineCost: anyBaseline ? String(baselineAll) : null,
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
        plannedCost: null, baselineCost: null,
        otherDirectCost: '0', labourCost: '0', labourHours: '0', actualCost: '0',
        deliverablesAccepted: 0, deliverablesTotal: 0, nodesWithDates: 0,
      },
      clins: [],
      variance: [],
    };
  }
}
