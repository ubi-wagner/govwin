import { describe, it, expect } from 'vitest';
import {
  computeBudget, budgetAsDisplay, roundCents, popByMonths, popByYear, popBasePlusOption, singlePeriod,
  type LaborLine, type IndirectRates, type OtherDirectCost, type Subcontract,
} from '@/lib/proposal/cost-model';

// ─── Shared parity fixture ──────────────────────────────────────────────────────
// The SAME inputs are run through pipeline/src/proposal/budget_model.py; the expected
// numbers below are that engine's ground-truth output (captured to the cent). If the
// waterfall ever diverges between services, this test fails.
const LABOR: LaborLine[] = [
  { name: 'Dr. Ada Lovelace', category: 'Principal Investigator', hours: 500, unburdenedRate: 85 },
  { name: 'Grace Hopper', category: 'Senior Engineer', hours: 400, unburdenedRate: 75 },
  { name: 'Alan Turing', category: 'Research Scientist', hours: 300, unburdenedRate: 70 },
];
const RATES: IndirectRates = { fringePct: 0.35, overheadPct: 0.45, gnaPct: 0.15, feePct: 0.07 };
const ODCS: OtherDirectCost[] = [
  { kind: 'materials', label: 'Prototype components', amount: 6000 },
  { kind: 'travel', label: 'Kickoff + final review', amount: 2000 },
  { kind: 'equipment', label: 'Test rig', amount: 0 },
  { kind: 'odc_other', label: 'Publication fees', amount: 500 },
];
const SUBS: Subcontract[] = [
  { org: 'State University', role: 'Feasibility research', amount: 40000, isResearchInstitution: true },
  { org: 'Robotics Consultant', role: 'SME advisory', amount: 8000 },
];

describe('cost-model — parity with the Python budget engine (to the cent)', () => {
  it('single period: the full burden waterfall matches budget_model.py exactly', () => {
    const d = budgetAsDisplay(computeBudget(LABOR, RATES, { odcs: ODCS, subs: SUBS })).grand;
    expect(d.directLabor).toBe(93500);      // 500×85 + 400×75 + 300×70
    expect(d.fringe).toBe(32725);           // 93500 × 0.35
    expect(d.overhead).toBe(56801.25);      // (93500+32725) × 0.45
    expect(d.odcTotal).toBe(8500);          // 6000+2000+0+500
    expect(d.subcontracts).toBe(48000);
    expect(d.totalBeforeGna).toBe(239526.25);
    expect(d.gna).toBe(35928.94);           // 239526.25 × 0.15 (full 35928.9375)
    expect(d.totalEstCost).toBe(275455.19); // + G&A (full 275455.1875)
    expect(d.fee).toBe(19281.86);           // × 0.07
    expect(d.totalPrice).toBe(294737.05);   // TOTAL PROPOSED PRICE
  });

  it('work-share matches (SBC 72%, sub 16%, RI 14% of price)', () => {
    const ws = budgetAsDisplay(computeBudget(LABOR, RATES, { odcs: ODCS, subs: SUBS })).workshare;
    expect(ws.sbcWorkPct).toBe(0.72);
    expect(ws.subcontractShareOfPrice).toBe(0.16);
    expect(ws.researchInstitutionShareOfPrice).toBe(0.14);
  });

  it('linearity invariant: a multi-period grand equals the single-period grand', () => {
    const single = computeBudget(LABOR, RATES, { odcs: ODCS, subs: SUBS }).grand;
    const twoP = computeBudget(LABOR, RATES, { odcs: ODCS, subs: SUBS, periods: popByMonths(24, 12) }).grand;
    const yearly = computeBudget(LABOR, RATES, { odcs: ODCS, subs: SUBS, periods: popByYear(3) }).grand;
    for (const k of ['directLabor', 'fringe', 'overhead', 'gna', 'totalEstCost', 'fee', 'totalPrice'] as const) {
      expect(twoP[k]).toBeCloseTo(single[k], 6);
      expect(yearly[k]).toBeCloseTo(single[k], 6);
    }
    expect(popByMonths(24, 12)).toHaveLength(2);
    expect(popByMonths(30, 12)).toHaveLength(3); // trailing partial bucket kept
  });

  it('realism flags: ceiling + overhead cap + STTR RI floor fire with the exact messages', () => {
    const r = computeBudget(LABOR, RATES, {
      odcs: ODCS, subs: SUBS, ceiling: 200000, program: 'sttr', indirectCaps: { overheadPct: 0.4 },
    });
    const issues = r.realismFlags.map((f) => f.issue);
    expect(issues).toContain('Total proposed price $294,737.05 exceeds the funding ceiling $200,000.00 by $94,737.05.');
    expect(issues).toContain('Overhead rate 45.0% exceeds the solicitation cap 40.0%.');
    expect(issues).toContain('Research-institution share 13.6% is below the STTR 30% floor.');
    expect(r.realismFlags.filter((f) => f.severity === 'high')).toHaveLength(2);
  });
});

describe('cost-model — edges', () => {
  it('empty labor + no rates → placeholder flags, zero price', () => {
    const r = computeBudget([], { fringePct: 0, overheadPct: 0, gnaPct: 0, feePct: 0 });
    expect(r.grand.totalPrice).toBe(0);
    expect(r.realismFlags.map((f) => f.issue)).toContain('No direct labor provided — labor basis is a placeholder.');
    expect(r.realismFlags.map((f) => f.issue)).toContain('No indirect rates provided — burden is a placeholder.');
    // work-share with no subs is 100% SBC (no division by zero)
    expect(r.workshare.sbcWorkPct).toBe(1);
  });

  it('SBIR work-share floor (67%) fires when subs dominate', () => {
    const r = computeBudget(
      [{ name: 'PI', category: 'PI', hours: 100, unburdenedRate: 100 }], // DL 10k, fringe 3.5k → effort 13.5k
      RATES,
      { subs: [{ org: 'Big Sub', role: 'most of the work', amount: 100000 }], program: 'sbir' },
    );
    expect(r.workshare.sbcWorkPct).toBeLessThan(0.67);
    expect(r.realismFlags.some((f) => /Small-business work share .* below the SBIR floor 67%/.test(f.issue))).toBe(true);
  });

  it('fee over 10% is flagged; a bad allocation length throws', () => {
    const hot = computeBudget(LABOR, { ...RATES, feePct: 0.15 }, { odcs: ODCS });
    expect(hot.realismFlags.some((f) => /Fee\/profit 15\.0% exceeds/.test(f.issue))).toBe(true);
    expect(() => computeBudget(
      [{ name: 'x', category: 'y', hours: 1, unburdenedRate: 1, allocation: [0.5] }],
      RATES, { periods: popBasePlusOption([['Base', 12], ['Option', 12]]) },
    )).toThrow(/allocation length/);
    expect(singlePeriod()).toHaveLength(1);
  });

  it('rejects an unknown ODC kind', () => {
    expect(() => computeBudget(LABOR, RATES, { odcs: [{ kind: 'bogus' as never, label: 'x', amount: 1 }] }))
      .toThrow(/unknown ODC kind/);
  });
});

describe('roundCents — matches Python round() (banker\'s, not Math.round half-up)', () => {
  it('rounds half-to-even on exact ties and up on the true-binary value', () => {
    // Verified equal to Python round(x,2) over a 2,220-value sweep. Math.round would give .63/.13.
    expect(roundCents(2642.625)).toBe(2642.62);   // exact tie → even (2)
    expect(roundCents(20260.125)).toBe(20260.12); // exact tie → even (2)
    expect(roundCents(67443.705)).toBe(67443.71); // true binary just above → up
    expect(roundCents(9454.725)).toBe(9454.73);
    expect(roundCents(144522.225)).toBe(144522.23);
    expect(roundCents(11975.985)).toBe(11975.99);
    expect(roundCents(100)).toBe(100);
    expect(roundCents(0)).toBe(0);
  });
});
