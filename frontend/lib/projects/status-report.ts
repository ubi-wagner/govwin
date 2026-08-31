/**
 * The status report — a canvas document whose numbers are read, not typed.
 *
 * ── IT IS A DELIVERABLE, NOT A NEW KIND OF THING ─────────────────────────────────────────────
 * "Monthly Status Report" is a CDRL: a data requirement with a frequency, producing one deliverable
 * per period under its own milestone. So this is not a reports table and not a reports page — it is
 * a `preset` on `authorDeliverable`, and everything downstream is unchanged: the same editor, the
 * same compliance floor, the same docx/pptx/xlsx/pdf exporters, the same internal acceptance, the
 * same "sent to the customer" state, the same CDRL register counting it.
 *
 * The only thing that differs is what the starter contains.
 *
 * ── WHY PREFILLING IS LEGITIMATE HERE AND WAS NOT FOR A BLANK DELIVERABLE ────────────────────
 * G3's rule stands: a starter carries **only facts read off a row**, because scaffolding plausible
 * headings would put structure nobody asked for into a contract deliverable. A status report does
 * not violate that — it is the one document whose entire content IS rows. Every number below comes
 * from `rollup()`, `milestoneVariance()`, the risk register and the billing position. Nothing is
 * invented, and nothing is left as a prompt for somebody to fill in.
 *
 * ── AND IT IS A SNAPSHOT ─────────────────────────────────────────────────────────────────────
 * The document is written once and then edited by a person. It does NOT re-compute when reopened,
 * and that is the correct behaviour: a report submitted in June has to keep saying what it said in
 * June. The "as at" line in the header is what makes that legible rather than confusing.
 *
 * ── THE THREE MEASURES STAY THREE ────────────────────────────────────────────────────────────
 * Cost, schedule and deliverables are rendered side by side and never blended, exactly as
 * `rollup.ts` refuses to blend them. Sixty percent of budget against forty percent of schedule is
 * the single most useful line in a status report, and an average destroys it while still looking
 * like an answer. A measure with no denominator renders **"not measured"**, never `0%`.
 */
import { createNode, type CanvasNode } from '@/lib/types/canvas-document';
import type { Measures, ProjectRollup } from './rollup';
import type { ClinBilling } from './invoices';
import { isoDate } from './dates';

export interface StatusReportInput {
  /**
   * The DOCUMENT's title — which is the deliverable's own title, e.g. "Monthly status report —
   * June". The H1 has to be this and not the project name: `authorDeliverable` names the
   * `tenant_documents` row after the deliverable, and a document titled one thing and headed
   * another is one a person cannot match to the obligation it satisfies. `probe-deliverable-
   * artifacts` caught exactly that — the `.pptx` render carried no text naming the deliverable,
   * because the heading was about the project instead.
   */
  title: string;
  projectName: string;
  /** The period this report covers. Either end may be null — a report on an event has no month. */
  periodStart: string | null;
  periodEnd: string | null;
  /** The day the numbers were read. Passed in, never `new Date()` here — a builder that reads the
   *  clock cannot be tested, and the caller already knows when it is generating. */
  asAt: string;
  rollup: ProjectRollup;
  billing: ClinBilling[];
  risks: Array<{ title: string; kind: string; status: string; score: number; mitigation: string | null }>;
  /** Work closed in the period, and what is open — both counted from the checklist rows. */
  tasksDone: number;
  tasksOpen: number;
  tasksBlocked: number;
  /** Deliverables with a required-by date inside or after the period, not yet sent. */
  upcoming: Array<{ title: string; requiredBy: string | null; milestone: string | null; sent: boolean }>;
}

/**
 * Who the canvas records as having drafted each node. `createNode` demands it, and 'Project' rather
 * than a person's name is the truthful answer: the system read these numbers off rows, and
 * attributing them to whoever clicked the button would credit them with figures they did not write.
 */
interface Who { actorId: string; actorName: string }

/** A percentage as a person reads it, or the honest absence of one. */
export function pctText(v: number | null): string {
  return v === null ? 'not measured' : `${v}%`;
}

const usd = (v: number | string | null | undefined) =>
  v === null || v === undefined || v === ''
    ? '—'
    : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/**
 * The three measures as a table — with their RAW COUNTS beside each percentage.
 *
 * A percentage whose denominator is invisible is a percentage nobody can check, and a status report
 * is precisely the document where somebody will try to.
 */
function measuresTable(m: Measures, who: Who): CanvasNode {
  return createNode({
    type: 'table',
    content: {
      headers: ['Measure', 'Value', 'Computed from'],
      rows: [
        ['Cost', pctText(m.costPct),
          m.plannedCost === null ? 'no planned cost recorded'
            : `${usd(m.actualCost)} of ${usd(m.plannedCost)} planned`],
        ['Schedule', pctText(m.schedulePct),
          m.nodesWithDates === 0 ? 'no milestone carries both dates'
            : `duration-weighted across ${m.nodesWithDates} milestone${m.nodesWithDates === 1 ? '' : 's'}`],
        ['Deliverables', pctText(m.deliverablesPct),
          m.deliverablesTotal === 0 ? 'none declared'
            : `${m.deliverablesAccepted} of ${m.deliverablesTotal} accepted`],
      ],
    },
    source: 'template',
    ...who,
  });
}

function heading(text: string, level: 1 | 2, who: Who): CanvasNode {
  return createNode({ type: 'heading', content: { level, text }, source: 'template', ...who });
}

function text(body: string, who: Who): CanvasNode {
  return createNode({ type: 'text_block', content: { text: body }, source: 'template', ...who });
}

/**
 * Build the report.
 *
 * A section is OMITTED when it has no rows rather than rendered as an empty table under a heading.
 * "Risks and issues" over an empty grid reads as "we have none"; leaving the section out and saying
 * so in one line is the difference between a report and a form somebody forgot to fill in.
 */
export function buildStatusReport(input: StatusReportInput, actorId: string): CanvasNode[] {
  const who: Who = { actorId, actorName: 'Project' };
  const nodes: CanvasNode[] = [];
  const period = [isoDate(input.periodStart), isoDate(input.periodEnd)].filter(Boolean).join(' — ');

  nodes.push(heading(input.title, 1, who));
  nodes.push(text(
    [
      // The project is CONTEXT under the title, the same shape a blank deliverable's starter uses.
      input.projectName,
      period ? `Reporting period: ${period}.` : null,
      // The snapshot line. Without it a reader cannot tell a June report from a stale one, and the
      // numbers below never move again once this document is saved.
      `Figures as at ${isoDate(input.asAt) ?? input.asAt}; they are a snapshot and do not update.`,
    ].filter(Boolean).join(' '),
    who,
  ));

  // ── PROGRESS ────────────────────────────────────────────────────────────────────────────────
  nodes.push(heading('Progress', 2, who));
  nodes.push(text(
    'Three independent measures, reported side by side. They are not combined: the useful signal is '
    + 'where they disagree, and an average would destroy it while still looking like an answer.',
    who,
  ));
  nodes.push(measuresTable(input.rollup.project, who));

  // ── SCHEDULE ────────────────────────────────────────────────────────────────────────────────
  const variance = input.rollup.variance ?? [];
  if (variance.length > 0) {
    nodes.push(heading('Milestones', 2, who));
    nodes.push(createNode({
      type: 'table',
      content: {
        headers: ['Milestone', 'Status', 'Variance against baseline'],
        rows: variance.map((v) => [
          v.title,
          v.status,
          // NEVER a bare number: "14" could be days early. And null is "no baseline", which is a
          // different statement from "on time" and must not render as one.
          v.varianceDays === null ? 'no baseline'
            : v.varianceDays === 0 ? 'on baseline'
            : v.varianceDays > 0 ? `${v.varianceDays} day${v.varianceDays === 1 ? '' : 's'} late`
            : `${-v.varianceDays} day${v.varianceDays === -1 ? '' : 's'} early`,
        ]),
      },
      source: 'template',
      ...who,
    }));
  }

  // ── WORK ────────────────────────────────────────────────────────────────────────────────────
  nodes.push(heading('Work', 2, who));
  nodes.push(text(
    `${input.tasksDone} task${input.tasksDone === 1 ? '' : 's'} closed; `
    + `${input.tasksOpen} open`
    + (input.tasksBlocked > 0 ? `, of which ${input.tasksBlocked} blocked.` : '.'),
    who,
  ));

  // ── COST AND BILLING ────────────────────────────────────────────────────────────────────────
  if (input.billing.length > 0) {
    nodes.push(heading('Funding and billing', 2, who));
    nodes.push(createNode({
      type: 'table',
      content: {
        headers: ['CLIN', 'Authorised', 'Claimed', 'Paid', 'Remaining'],
        rows: input.billing.map((b) => [
          b.clinNumber,
          usd(b.fundedAmount),
          usd(b.billed),
          usd(b.paid),
          // "funding not set", never $0. Zero is a measurement; a missing ceiling is not one.
          b.remaining === null ? 'funding not set' : usd(b.remaining),
        ]),
      },
      source: 'template',
      ...who,
    }));
  }

  // ── RISK ────────────────────────────────────────────────────────────────────────────────────
  const open = input.risks.filter((r) => r.status === 'open');
  nodes.push(heading('Risks and issues', 2, who));
  if (open.length === 0) {
    // Said in a sentence rather than shown as an empty table. An empty grid under a heading reads
    // as a form somebody did not finish.
    nodes.push(text('No open risks or issues on the register at this date.', who));
  } else {
    nodes.push(createNode({
      type: 'table',
      content: {
        headers: ['Item', 'Kind', 'Score', 'Mitigation'],
        rows: open.map((r) => [r.title, r.kind, String(r.score), r.mitigation ?? '—']),
      },
      source: 'template',
      ...who,
    }));
  }

  // ── WHAT IS COMING ──────────────────────────────────────────────────────────────────────────
  const due = input.upcoming.filter((u) => !u.sent);
  if (due.length > 0) {
    nodes.push(heading('Deliverables outstanding', 2, who));
    nodes.push(createNode({
      type: 'table',
      content: {
        headers: ['Deliverable', 'Milestone', 'Required by'],
        rows: due.map((u) => [u.title, u.milestone ?? '—', isoDate(u.requiredBy) ?? 'not dated']),
      },
      source: 'template',
      ...who,
    }));
  }

  return nodes;
}
