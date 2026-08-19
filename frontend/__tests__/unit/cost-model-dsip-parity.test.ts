import { describe, it, expect } from 'vitest';
import { computeBudget, roundCents, type LaborLine, type IndirectRates } from '@/lib/proposal/cost-model';

/**
 * GROUND-TRUTH PARITY — the burden engine against a real, submitted DSIP cost volume.
 *
 * Every other cost test checks the engine against itself. This one checks it against the agency:
 * the numbers below are the ones DSIP itself computed and printed on the submitted Phase I cost
 * volume for proposal O26BZ-DP013-0272 (topic OSW26BZ04-DP013). If our engine and DSIP disagree
 * by a cent, the customer's cost volume does not reconcile with the form they file, and the
 * mismatch is the kind a contracting officer notices.
 *
 * It also pins the rate structure that made the difference. DSIP's cost form asks three separate
 * questions — "Apply G&A Rate to Overhead Costs?", "…to Direct Labor Costs?", "…to Direct Material
 * Costs?" — and this firm answered NO / YES / YES. That is a VALUE-ADDED G&A base that excludes
 * overhead. Under the classic total-cost-input base the same inputs produce $73,795.33 of G&A
 * instead of $49,122.08 and a total of $276,363.50 — $26,363.50 over the $250,000 Phase I
 * ceiling. So the rate structure is not a presentation detail: with it unmodelled the engine
 * reports this compliant proposal as over-ceiling and the customer cuts scope they did not need
 * to cut.
 */

// ── The five labor categories exactly as filed (DSIP standard category / individual title) ──
const LABOR: LaborLine[] = [
  { name: 'Principal Investigator', category: 'Chief Executive', hours: 190, unburdenedRate: 50.0 },
  { name: 'Chief Scientist', category: 'Physicist', hours: 404, unburdenedRate: 63.0 },
  { name: 'Electrical Engineer', category: 'Electrical Engineer', hours: 400, unburdenedRate: 45.0 },
  { name: 'Senior Optics Engineer', category: 'Engineers, All Other', hours: 320, unburdenedRate: 50.0 },
  { name: 'Software Engineer', category: 'Software Developer', hours: 160, unburdenedRate: 45.0 },
];

const RATES: IndirectRates = {
  fringePct: 0.35,
  overheadPct: 0.60,
  gnaPct: 0.40,
  feePct: 0.07,
  gnaAppliesToOverhead: false, // DSIP: "Apply G&A Rate to Overhead Costs? NO"
};

const MATERIALS = 20_000; // LCD Matrix and Controller — AlphaMicron, consumed into the deliverable

const run = () => computeBudget(LABOR, RATES, {
  odcs: [{ kind: 'materials', name: 'LCD Matrix and Controller', amount: MATERIALS }],
  ceiling: 250_000,
  program: 'sbir',
}).grand;

describe('burden engine · parity with the filed DSIP cost volume (O26BZ-DP013-0272)', () => {
  it('reproduces every band of the filed waterfall to the cent', () => {
    const g = run();

    // Direct labor: Σ(hours × rate). DSIP prints this as the sum of the per-category "Cost"
    // column MINUS fringe — i.e. the unburdened base.
    expect(roundCents(g.directLabor)).toBe(76_152.00);

    // DSIP's per-row "Cost" column is base + fringe, and its "Subtotal Direct Labor (DL)" is
    // the sum of those rows — so DSIP's "DL" is our directLabor + fringe.
    expect(roundCents(g.directLabor + g.fringe)).toBe(102_805.20);

    // Labor Overhead (rate 60%) x (DL) = $61,683.12, where DSIP's DL is labor+fringe.
    expect(roundCents(g.overhead)).toBe(61_683.12);

    // Total Direct Labor (TDL) = DL + overhead = $164,488.32
    expect(roundCents(g.directLabor + g.fringe + g.overhead)).toBe(164_488.32);

    // Total Direct Material Costs (TDM)
    expect(roundCents(g.materials)).toBe(20_000.00);

    // G&A (rate 40%) — filed as $49,122.08, i.e. 40% of (102,805.20 + 20,000). The form's own
    // label reads "x Base (TDL+TDM)" but the arithmetic it prints excludes overhead, matching
    // the three YES/NO answers. The printed NUMBER is the contract, not the label.
    expect(roundCents(g.gna)).toBe(49_122.08);

    // Total Firm Costs = TDL + TDM + G&A
    expect(roundCents(g.totalEstCost)).toBe(233_610.40);

    // Profit Rate (7%)
    expect(roundCents(g.fee)).toBe(16_352.73);

    // Total Estimated Cost / Total Dollar Amount for this Proposal
    expect(roundCents(g.totalPrice)).toBe(249_963.13);
  });

  it('lands inside the $250,000 Phase I ceiling — with $36.87 to spare', () => {
    const g = run();
    expect(g.totalPrice).toBeLessThanOrEqual(250_000);
    expect(roundCents(250_000 - g.totalPrice)).toBe(36.87);
  });

  it('raises no ceiling flag at the filed price, and does raise one a dollar over', () => {
    const flags = computeBudget(LABOR, RATES, {
      odcs: [{ kind: 'materials', name: 'LCD Matrix and Controller', amount: MATERIALS }],
      ceiling: 250_000, program: 'sbir',
    }).realismFlags;
    expect(flags.some((f) => /ceiling/i.test(f.issue))).toBe(false);

    const over = computeBudget(LABOR, RATES, {
      odcs: [{ kind: 'materials', name: 'LCD Matrix and Controller', amount: MATERIALS + 200 }],
      ceiling: 250_000, program: 'sbir',
    });
    expect(over.grand.totalPrice).toBeGreaterThan(250_000);
    expect(over.realismFlags.some((f) => /ceiling/i.test(f.issue))).toBe(true);
  });

  it('the value-added G&A base is what makes it fit — the classic base blows the ceiling', () => {
    // This is the whole reason gnaAppliesToOverhead exists. Same labor, same materials, same
    // rates; only the G&A base differs.
    const classic = computeBudget(LABOR, { ...RATES, gnaAppliesToOverhead: true }, {
      odcs: [{ kind: 'materials', name: 'LCD Matrix and Controller', amount: MATERIALS }],
      ceiling: 250_000, program: 'sbir',
    }).grand;
    expect(roundCents(classic.gna)).toBe(73_795.33);
    expect(roundCents(classic.totalPrice)).toBe(276_363.50);
    expect(classic.totalPrice).toBeGreaterThan(250_000);
  });

  it('clears the SBIR two-thirds work-share floor — all work is in-house, no subcontracts', () => {
    const r = computeBudget(LABOR, RATES, {
      odcs: [{ kind: 'materials', name: 'LCD Matrix and Controller', amount: MATERIALS }],
      ceiling: 250_000, program: 'sbir',
    });
    expect(r.grand.subcontracts).toBe(0);
    expect(r.workshare.sbcWorkPct).toBe(1);
    expect(r.workshare.subcontractShareOfPrice).toBe(0);
    expect(r.realismFlags.some((f) => /work.?share/i.test(f.issue))).toBe(false);
  });

  it('totals 1,474 direct labor hours across the five categories', () => {
    expect(LABOR.reduce((a, l) => a + l.hours, 0)).toBe(1474);
  });
});
