/**
 * THE STATUS REPORT — a document whose numbers are read, not typed.
 *
 * The builder is pure, so every rule about what the report SAYS is testable without a database.
 * Three rules are worth holding onto, and each has a way of failing that looks fine:
 *
 *  1. **The three measures stay three.** A blended figure would still look like an answer.
 *  2. **A measure with no denominator says "not measured"**, never `0%` — and a report is exactly
 *     where a confident zero gets believed.
 *  3. **A variance of null is "no baseline"**, which is a different statement from "on time".
 */
import { describe, it, expect } from 'vitest';
import { buildStatusReport, pctText, type StatusReportInput } from '@/lib/projects/status-report';
import type { ProjectRollup, Measures } from '@/lib/projects/rollup';

const MEASURED: Measures = {
  costPct: 60, schedulePct: 40, deliverablesPct: 33.3,
  plannedCost: '750000', baselineCost: '750000', otherDirectCost: '200000',
  labourCost: '250000', labourHours: '1800', actualCost: '450000',
  deliverablesAccepted: 1, deliverablesTotal: 3, nodesWithDates: 4,
};

const UNMEASURED: Measures = {
  costPct: null, schedulePct: null, deliverablesPct: null,
  plannedCost: null, baselineCost: null, otherDirectCost: '0',
  labourCost: '0', labourHours: '0', actualCost: '0',
  deliverablesAccepted: 0, deliverablesTotal: 0, nodesWithDates: 0,
};

function input(over: Partial<StatusReportInput> = {}): StatusReportInput {
  const r: ProjectRollup = {
    project: MEASURED,
    clins: [],
    variance: [
      { id: 'm1', title: 'Kickoff', varianceDays: -3, status: 'met' },
      { id: 'm2', title: 'Critical design review', varianceDays: 14, status: 'pending' },
      { id: 'm3', title: 'Prototype demonstration', varianceDays: null, status: 'pending' },
      { id: 'm4', title: 'Final report', varianceDays: 0, status: 'pending' },
    ],
  };
  return {
    title: 'Monthly status report — June',
    projectName: 'USAF SBIR Phase II',
    periodStart: '2026-05-01', periodEnd: '2026-05-31', asAt: '2026-06-02',
    rollup: r,
    billing: [
      { clinId: 'c1', clinNumber: '0001', fundedAmount: '750000', billed: 500000, paid: 450000, remaining: 250000 },
      { clinId: 'c2', clinNumber: '0002', fundedAmount: null, billed: 0, paid: 0, remaining: null },
    ],
    risks: [
      { title: 'Actuator lead time', kind: 'risk', status: 'open', score: 15, mitigation: 'Second source qualified' },
      { title: 'Bench failure', kind: 'issue', status: 'closed', score: 20, mitigation: null },
    ],
    tasksDone: 7, tasksOpen: 3, tasksBlocked: 1,
    upcoming: [
      { title: 'CDR package', requiredBy: '2026-06-15', milestone: 'Critical design review', sent: false },
      { title: 'Kickoff brief', requiredBy: '2026-02-01', milestone: 'Kickoff', sent: true },
    ],
    ...over,
  };
}

/** Every string in the document, flattened — headings, paragraphs and every table cell. */
function allText(nodes: ReturnType<typeof buildStatusReport>): string {
  const out: string[] = [];
  for (const n of nodes) {
    const c = n.content as Record<string, unknown>;
    if (typeof c.text === 'string') out.push(c.text);
    if (Array.isArray(c.headers)) out.push(...(c.headers as string[]));
    if (Array.isArray(c.rows)) for (const row of c.rows as string[][]) out.push(...row);
  }
  return out.join(' | ');
}

describe('the three measures stay three', () => {
  it('renders cost, schedule and deliverables as separate rows', () => {
    const doc = buildStatusReport(input(), 'u1');
    const t = allText(doc);
    expect(t).toMatch(/Cost \| 60%/);
    expect(t).toMatch(/Schedule \| 40%/);
    expect(t).toMatch(/Deliverables \| 33\.3%/);
  });

  it('exposes NO blended figure', () => {
    // 60, 40 and 33.3 average to 44.4. If a future edit ever "summarises" them, this is what
    // catches it — the number that looks most like an answer and is worth the least.
    const doc = buildStatusReport(input(), 'u1');
    expect(allText(doc)).not.toMatch(/44\.4|overall\s+progress|percent complete/i);
  });

  it('shows each percentage BESIDE what it was computed from', () => {
    // A percentage whose denominator is invisible is one nobody can check, and a status report is
    // exactly the document where somebody will try to.
    const t = allText(buildStatusReport(input(), 'u1'));
    expect(t).toMatch(/1 of 3 accepted/);
    expect(t).toMatch(/duration-weighted across 4 milestones/);
  });
});

describe('a measure with no denominator', () => {
  it('says "not measured", never 0%', () => {
    const doc = buildStatusReport(input({
      rollup: { project: UNMEASURED, clins: [], variance: [] },
    }), 'u1');
    const t = allText(doc);
    expect(t).toMatch(/Cost \| not measured/);
    expect(t).toMatch(/Schedule \| not measured/);
    expect(t).toMatch(/Deliverables \| not measured/);
    expect(t, 'a confident zero is the thing this rule exists to prevent').not.toMatch(/\| 0% \|/);
  });

  it('and says WHY there is no number', () => {
    const t = allText(buildStatusReport(input({
      rollup: { project: UNMEASURED, clins: [], variance: [] },
    }), 'u1'));
    expect(t).toMatch(/no planned cost recorded/);
    expect(t).toMatch(/no milestone carries both dates/);
    expect(t).toMatch(/none declared/);
  });

  it('pctText is the one place the rule lives', () => {
    expect(pctText(null)).toBe('not measured');
    expect(pctText(0)).toBe('0%');   // a MEASURED zero still says zero
    expect(pctText(43.3)).toBe('43.3%');
  });
});

describe('milestone variance', () => {
  it('never renders a bare number — "14" could be days early', () => {
    const t = allText(buildStatusReport(input(), 'u1'));
    expect(t).toMatch(/14 days late/);
    expect(t).toMatch(/3 days early/);
  });

  it('renders a NULL variance as "no baseline", not as on time', () => {
    // Two different statements. A milestone nobody baselined has no variance to report, and
    // rendering it as "on baseline" claims a promise was kept that was never made.
    const t = allText(buildStatusReport(input(), 'u1'));
    expect(t).toMatch(/no baseline/);
    expect(t).toMatch(/on baseline/);   // and a real zero still says so
  });

  it('gets the singular right — "1 day late", not "1 days late"', () => {
    const r: ProjectRollup = {
      project: MEASURED, clins: [],
      variance: [{ id: 'm1', title: 'X', varianceDays: 1, status: 'pending' },
                 { id: 'm2', title: 'Y', varianceDays: -1, status: 'pending' }],
    };
    const t = allText(buildStatusReport(input({ rollup: r }), 'u1'));
    expect(t).toMatch(/1 day late/);
    expect(t).toMatch(/1 day early/);
    expect(t).not.toMatch(/1 days/);
  });
});

describe('the rest of the document', () => {
  it('says the figures are a SNAPSHOT — a June report keeps saying June', () => {
    const t = allText(buildStatusReport(input(), 'u1'));
    expect(t).toMatch(/as at 2026-06-02/);
    expect(t).toMatch(/snapshot and do not update/);
  });

  it('is HEADED with the document’s own title, not the project name', () => {
    // The document is named after the deliverable it satisfies, and a document titled one thing
    // and headed another cannot be matched to its obligation. `probe-deliverable-artifacts` found
    // this by rendering the .pptx and looking for the deliverable's name in the text layer.
    const doc = buildStatusReport(input(), 'u1');
    const h1 = doc.find((n) => n.type === 'heading');
    expect((h1!.content as { text: string }).text).toBe('Monthly status report — June');
    expect(allText(doc), 'and the project is context beneath it').toMatch(/USAF SBIR Phase II/);
  });

  it('carries the reporting period', () => {
    expect(allText(buildStatusReport(input(), 'u1'))).toMatch(/2026-05-01 — 2026-05-31/);
  });

  it('reports a CLIN with no funded amount as "funding not set", never $0', () => {
    const t = allText(buildStatusReport(input(), 'u1'));
    expect(t).toMatch(/funding not set/);
  });

  it('lists only OPEN risks — a closed one is history, not a status', () => {
    const t = allText(buildStatusReport(input(), 'u1'));
    expect(t).toMatch(/Actuator lead time/);
    expect(t).not.toMatch(/Bench failure/);
  });

  it('says so in a SENTENCE when the register is empty, rather than showing an empty table', () => {
    // An empty grid under a heading reads as a form somebody did not finish.
    const doc = buildStatusReport(input({ risks: [] }), 'u1');
    expect(allText(doc)).toMatch(/No open risks or issues/);
    const tables = doc.filter((n) => n.type === 'table');
    expect(tables.every((t) => ((t.content as { rows?: unknown[] }).rows?.length ?? 0) > 0)).toBe(true);
  });

  it('lists deliverables that have NOT reached the customer, and omits ones that have', () => {
    const t = allText(buildStatusReport(input(), 'u1'));
    expect(t).toMatch(/CDR package/);
    expect(t, 'an already-sent deliverable is not outstanding').not.toMatch(/Kickoff brief/);
  });

  it('counts the work, and mentions blocked only when there is some', () => {
    expect(allText(buildStatusReport(input(), 'u1'))).toMatch(/7 tasks closed; 3 open, of which 1 blocked/);
    expect(allText(buildStatusReport(input({ tasksBlocked: 0 }), 'u1'))).toMatch(/7 tasks closed; 3 open\./);
  });

  it('marks every node as template-sourced — a person wrote none of this', () => {
    const doc = buildStatusReport(input(), 'u1');
    expect(doc.length).toBeGreaterThan(5);
    expect(doc.every((n) => n.provenance?.source === 'template')).toBe(true);
  });
});
