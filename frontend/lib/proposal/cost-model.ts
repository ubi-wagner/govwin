/**
 * Cost model — the deterministic government cost-volume burden waterfall, in TypeScript.
 *
 * This is a faithful port of the pipeline's `pipeline/src/proposal/budget_model.py`
 * `compute_budget`. The two MUST agree to the cent: the pipeline `cost_estimator` agent
 * computes advisory numbers with the Python engine; the frontend builds + validates the
 * exported cost volume with THIS one. A shared parity fixture locks them together
 * (see __tests__/unit/cost-model.test.ts).
 *
 * WHY a second copy instead of calling the pipeline: the cost volume is authored, filled,
 * validated (submission-readiness), and exported entirely in the frontend. The waterfall is
 * exact arithmetic — not an LLM guess — and is UNIVERSAL across agencies (DoW / NSF / DOE all
 * reduce to the same Direct Labor → Fringe → Overhead → ODC/Subs → G&A → Fee → Price spine).
 * Porting it once makes a computed cost volume available to every agency, not just DoD SBIR.
 *
 * WATERFALL (identical to budget_model.py):
 *   A. Direct Labor      = Σ(hours × unburdened_rate)
 *   B. Fringe            = A × fringe_pct                 (base: direct labor)
 *   C. Overhead          = (A + B) × overhead_pct         (base: labor + fringe)
 *   D..G Other Direct    = materials + travel + equipment + odc_other
 *   (F) Subcontracts     = Σ subcontract amounts          (pass-through)
 *   Total before G&A     = A + B + C + ODC + Subs         (G&A base includes subs)
 *   H. G&A               = (Total before G&A) × gna_pct
 *   Total Estimated Cost = (Total before G&A) + H
 *   I. Fee / Profit      = (Total Est. Cost) × fee_pct
 *   TOTAL PROPOSED PRICE = (Total Est. Cost) + I
 *
 * The waterfall is linear in the dollar bases, so allocating labor/ODC/subs across PoP
 * buckets and summing the per-bucket waterfalls yields the identical grand total as a
 * single-bucket computation (a tested invariant).
 *
 * INVARIANTS: pure & deterministic (no DB / LLM / network / clock); full precision
 * internally (round only for display); inputs are treated as immutable.
 */

/** ODC kinds that roll into the "Other Direct Costs" band (order = display order). */
export const ODC_KINDS = ['materials', 'travel', 'equipment', 'odc_other'] as const;
export type OdcKind = (typeof ODC_KINDS)[number];

/** Small-business-concern share of the research effort floors, by program. */
export const WORKSHARE_FLOOR: Record<string, number> = { sbir: 0.67, sttr: 0.4 };

/** Fee/profit is typically reasonable at ≤ this fraction (FAR 15.404 sanity, SBIR/STTR). */
export const FEE_REASONABLE_MAX = 0.1;

const CENTS = 2;

/**
 * Round to cents for display. Internal math never uses this — only outputs do.
 *
 * Matches Python's round(x, 2): round-half-to-EVEN (banker's rounding), so the frontend cost
 * volume agrees with the pipeline `cost_estimator`'s advisory numbers to the cent. (JS Math.round
 * is half-UP, which diverges on exact half-cent values like 2642.625 → 2642.62, not .63.)
 */
export function roundCents(x: number): number {
  if (!Number.isFinite(x)) return x;
  const neg = x < 0;
  const s = Math.abs(x).toPrecision(17); // full-precision decimal (reveals the true binary value)
  if (s.includes('e') || s.includes('E')) return Math.round(x * 100) / 100; // out of cost range → fallback
  const [ip, frac = ''] = s.split('.');
  const fp = frac.padEnd(3, '0');
  let cents = parseInt(ip + fp.slice(0, 2), 10); // whole number of cents (2dp), rounded DOWN so far
  const first = fp[2];
  const after = fp.slice(3).replace(/0+$/, '');
  if (first > '5' || (first === '5' && after !== '')) cents += 1;          // > half → up
  else if (first === '5' && after === '' && cents % 2 !== 0) cents += 1;   // exact tie → to even
  const r = cents / 100;
  return neg ? -r : r;
}

// ─── Typed inputs (treated as immutable) ────────────────────────────────────────

export interface LaborLine {
  name: string;
  category: string;
  hours: number;
  /** Unburdened hourly rate. */
  unburdenedRate: number;
  /** Per-PoP-bucket fractions (sum ≈ 1). Absent → spread evenly across buckets. */
  allocation?: number[] | null;
}

export interface OtherDirectCost {
  kind: OdcKind;
  label: string;
  amount: number;
  allocation?: number[] | null;
}

export interface Subcontract {
  org: string;
  role: string;
  amount: number;
  /** Marks STTR research-institution work (for the RI work-share floor). */
  isResearchInstitution?: boolean;
  allocation?: number[] | null;
}

export interface IndirectRates {
  /** Fractions, e.g. 0.35 == 35%. */
  fringePct: number;
  overheadPct: number;
  gnaPct: number;
  feePct: number;
}

export interface Period {
  name: string;
  /** Length in months (for even-weighting). */
  months: number;
}

export interface IndirectCaps {
  fringePct?: number | null;
  overheadPct?: number | null;
  gnaPct?: number | null;
}

export function directLabor(ln: LaborLine): number {
  return ln.hours * ln.unburdenedRate;
}

// ─── PoP builders ───────────────────────────────────────────────────────────────

/** Split a total PoP into equal buckets of `bucketMonths` (6/12/18/24…). A trailing
 * partial bucket is kept (30mo @ 12 → 12,12,6). Throws on non-positive inputs. */
export function popByMonths(totalMonths: number, bucketMonths: number): Period[] {
  if (totalMonths <= 0 || bucketMonths <= 0) throw new Error('totalMonths and bucketMonths must be positive');
  const periods: Period[] = [];
  let remaining = totalMonths;
  let idx = 1;
  while (remaining > 1e-9) {
    const span = Math.min(bucketMonths, remaining);
    periods.push({ name: `Period ${idx}`, months: span });
    remaining -= span;
    idx += 1;
  }
  return periods;
}

/** Explicit named periods, e.g. [["Base", 12], ["Option 1", 12]]. */
export function popBasePlusOption(periods: Array<[string, number]>): Period[] {
  if (!periods.length) throw new Error('at least one period is required');
  return periods.map(([name, months]) => ({ name, months }));
}

/** Year 1..n annual buckets. */
export function popByYear(nYears: number, monthsPerYear = 12): Period[] {
  if (nYears <= 0) throw new Error('nYears must be positive');
  return Array.from({ length: nYears }, (_, i) => ({ name: `Year ${i + 1}`, months: monthsPerYear }));
}

/** A single all-in bucket (no PoP split). */
export function singlePeriod(name = 'Total'): Period[] {
  return [{ name, months: 0 }];
}

// ─── Allocation helpers ─────────────────────────────────────────────────────────

function weights(periods: Period[]): number[] {
  const n = periods.length;
  const totalMonths = periods.reduce((a, p) => a + p.months, 0);
  if (totalMonths > 0) return periods.map((p) => p.months / totalMonths);
  return periods.map(() => 1 / n);
}

function allocFractions(allocation: number[] | null | undefined, periods: Period[]): number[] {
  const n = periods.length;
  if (allocation && allocation.length) {
    if (allocation.length !== n) throw new Error(`allocation length ${allocation.length} != period count ${n}`);
    const total = allocation.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error('allocation must sum to a positive value');
    return allocation.map((a) => a / total);
  }
  return weights(periods);
}

// ─── Result shapes ──────────────────────────────────────────────────────────────

export interface PeriodBreakdown {
  name: string;
  months: number;
  directLabor: number;
  fringe: number;
  overhead: number;
  materials: number;
  travel: number;
  equipment: number;
  odcOther: number;
  subcontracts: number;
  totalBeforeGna: number;
  gna: number;
  totalEstCost: number;
  fee: number;
  totalPrice: number;
}

export function odcTotal(b: PeriodBreakdown): number {
  return b.materials + b.travel + b.equipment + b.odcOther;
}

export interface Workshare {
  sbcWorkPct: number;
  subcontractShareOfPrice: number;
  researchInstitutionShareOfPrice: number;
}

export interface RealismFlag {
  issue: string;
  severity: 'low' | 'medium' | 'high';
}

export interface BudgetResult {
  periods: PeriodBreakdown[];
  grand: PeriodBreakdown;
  workshare: Workshare;
  realismFlags: RealismFlag[];
  rates: IndirectRates;
}

// ─── The engine ─────────────────────────────────────────────────────────────────

function periodWaterfall(
  name: string,
  months: number,
  dl: number,
  materials: number,
  travel: number,
  equipment: number,
  odcOther: number,
  subs: number,
  rates: IndirectRates,
): PeriodBreakdown {
  const fringe = dl * rates.fringePct;
  const overhead = (dl + fringe) * rates.overheadPct;
  const odc = materials + travel + equipment + odcOther;
  // G&A base includes subcontracts (matches the frontend template's A+B+C+D+E+F+G).
  const totalBeforeGna = dl + fringe + overhead + odc + subs;
  const gna = totalBeforeGna * rates.gnaPct;
  const totalEstCost = totalBeforeGna + gna;
  const fee = totalEstCost * rates.feePct;
  const totalPrice = totalEstCost + fee;
  return {
    name, months,
    directLabor: dl, fringe, overhead,
    materials, travel, equipment, odcOther,
    subcontracts: subs,
    totalBeforeGna, gna, totalEstCost, fee, totalPrice,
  };
}

export interface ComputeBudgetOptions {
  odcs?: OtherDirectCost[];
  subs?: Subcontract[];
  periods?: Period[];
  /** Solicitation funding ceiling → high flag if total price exceeds. */
  ceiling?: number | null;
  indirectCaps?: IndirectCaps | null;
  /** Max subcontract share of total price → flag if exceeded. */
  partnerMaxPct?: number | null;
  /** 'sbir' | 'sttr' (case-insensitive) → work-share floor flag. */
  program?: string | null;
}

/**
 * Compute the full cost volume: per-PoP-bucket burden waterfall + roll-up + work-share + flags.
 * Full precision; call `budgetAsDisplay()` for cents-rounded output.
 */
export function computeBudget(
  labor: LaborLine[],
  rates: IndirectRates,
  opts: ComputeBudgetOptions = {},
): BudgetResult {
  const odcs = opts.odcs ?? [];
  const subs = opts.subs ?? [];
  const periods = opts.periods && opts.periods.length ? opts.periods : singlePeriod();

  for (const kind of new Set(odcs.map((o) => o.kind))) {
    if (!ODC_KINDS.includes(kind)) throw new Error(`unknown ODC kind '${kind}'; allowed: ${ODC_KINDS.join(', ')}`);
  }

  const laborFracs = labor.map((ln) => ({ ln, fr: allocFractions(ln.allocation, periods) }));
  const odcFracs = odcs.map((o) => ({ o, fr: allocFractions(o.allocation, periods) }));
  const subFracs = subs.map((s) => ({ s, fr: allocFractions(s.allocation, periods) }));

  const breakdowns: PeriodBreakdown[] = periods.map((period, i) => {
    const dl = laborFracs.reduce((a, { ln, fr }) => a + directLabor(ln) * fr[i], 0);
    const materials = odcFracs.reduce((a, { o, fr }) => a + (o.kind === 'materials' ? o.amount * fr[i] : 0), 0);
    const travel = odcFracs.reduce((a, { o, fr }) => a + (o.kind === 'travel' ? o.amount * fr[i] : 0), 0);
    const equipment = odcFracs.reduce((a, { o, fr }) => a + (o.kind === 'equipment' ? o.amount * fr[i] : 0), 0);
    const odcOther = odcFracs.reduce((a, { o, fr }) => a + (o.kind === 'odc_other' ? o.amount * fr[i] : 0), 0);
    const subAmt = subFracs.reduce((a, { s, fr }) => a + s.amount * fr[i], 0);
    return periodWaterfall(period.name, period.months, dl, materials, travel, equipment, odcOther, subAmt, rates);
  });

  const grand = grandTotal(breakdowns);
  const workshare = computeWorkshare(grand, subs);
  const realismFlags = realismFlags_(grand, rates, subs, workshare, opts);
  return { periods: breakdowns, grand, workshare, realismFlags, rates };
}

function grandTotal(breakdowns: PeriodBreakdown[]): PeriodBreakdown {
  const s = (attr: keyof PeriodBreakdown): number =>
    breakdowns.reduce((a, b) => a + (b[attr] as number), 0);
  return {
    name: 'Grand Total',
    months: s('months'),
    directLabor: s('directLabor'),
    fringe: s('fringe'),
    overhead: s('overhead'),
    materials: s('materials'),
    travel: s('travel'),
    equipment: s('equipment'),
    odcOther: s('odcOther'),
    subcontracts: s('subcontracts'),
    totalBeforeGna: s('totalBeforeGna'),
    gna: s('gna'),
    totalEstCost: s('totalEstCost'),
    fee: s('fee'),
    totalPrice: s('totalPrice'),
  };
}

function computeWorkshare(grand: PeriodBreakdown, subs: Subcontract[]): Workshare {
  const sbcEffort = grand.directLabor + grand.fringe;
  const denom = sbcEffort + grand.subcontracts;
  const sbcWorkPct = denom > 0 ? sbcEffort / denom : 1;
  const subShareOfPrice = grand.totalPrice > 0 ? grand.subcontracts / grand.totalPrice : 0;
  const riAmount = subs.filter((s) => s.isResearchInstitution).reduce((a, s) => a + s.amount, 0);
  const riShareOfPrice = grand.totalPrice > 0 ? riAmount / grand.totalPrice : 0;
  return {
    sbcWorkPct,
    subcontractShareOfPrice: subShareOfPrice,
    researchInstitutionShareOfPrice: riShareOfPrice,
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
function money(x: number): string {
  return `$${roundCents(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function realismFlags_(
  grand: PeriodBreakdown,
  rates: IndirectRates,
  subs: Subcontract[],
  workshare: Workshare,
  opts: ComputeBudgetOptions,
): RealismFlag[] {
  const flags: RealismFlag[] = [];

  // Missing-input placeholders (advisory: the tenant must fill these in).
  if (grand.directLabor <= 0) flags.push({ issue: 'No direct labor provided — labor basis is a placeholder.', severity: 'high' });
  if (rates.fringePct <= 0 && rates.overheadPct <= 0 && rates.gnaPct <= 0)
    flags.push({ issue: 'No indirect rates provided — burden is a placeholder.', severity: 'high' });

  // Funding ceiling.
  if (opts.ceiling != null && grand.totalPrice > opts.ceiling + 1e-6) {
    const over = grand.totalPrice - opts.ceiling;
    flags.push({
      issue: `Total proposed price ${money(grand.totalPrice)} exceeds the funding ceiling ${money(opts.ceiling)} by ${money(over)}.`,
      severity: 'high',
    });
  }

  // Indirect-rate caps.
  if (opts.indirectCaps) {
    const caps: Array<[string, number, number | null | undefined]> = [
      ['Fringe', rates.fringePct, opts.indirectCaps.fringePct],
      ['Overhead', rates.overheadPct, opts.indirectCaps.overheadPct],
      ['G&A', rates.gnaPct, opts.indirectCaps.gnaPct],
    ];
    for (const [label, rate, cap] of caps) {
      if (cap != null && rate > cap + 1e-9)
        flags.push({ issue: `${label} rate ${pct(rate)} exceeds the solicitation cap ${pct(cap)}.`, severity: 'high' });
    }
  }

  // Subcontract / partner share limit.
  if (opts.partnerMaxPct != null) {
    const share = workshare.subcontractShareOfPrice;
    if (share > opts.partnerMaxPct + 1e-9)
      flags.push({ issue: `Subcontract share ${pct(share)} of total price exceeds the partner limit ${pct(opts.partnerMaxPct)}.`, severity: 'high' });
  }

  // Work-share floor (SBIR/STTR).
  const prog = (opts.program ?? '').toLowerCase();
  const floor = WORKSHARE_FLOOR[prog];
  if (floor != null) {
    const sbc = workshare.sbcWorkPct;
    if (sbc < floor - 1e-9)
      flags.push({ issue: `Small-business work share ${pct(sbc)} is below the ${prog.toUpperCase()} floor ${(floor * 100).toFixed(0)}%.`, severity: 'high' });
    if (prog === 'sttr') {
      const ri = workshare.researchInstitutionShareOfPrice;
      if (ri < 0.3 - 1e-9)
        flags.push({ issue: `Research-institution share ${pct(ri)} is below the STTR 30% floor.`, severity: 'medium' });
    }
  }

  // Fee reasonableness.
  if (rates.feePct > FEE_REASONABLE_MAX + 1e-9)
    flags.push({ issue: `Fee/profit ${pct(rates.feePct)} exceeds the typical reasonable ceiling ${(FEE_REASONABLE_MAX * 100).toFixed(0)}%.`, severity: 'medium' });

  return flags;
}

// ─── Display rounding ───────────────────────────────────────────────────────────

export function periodAsDisplay(b: PeriodBreakdown): Record<string, number | string> {
  return {
    name: b.name,
    months: b.months,
    directLabor: roundCents(b.directLabor),
    fringe: roundCents(b.fringe),
    overhead: roundCents(b.overhead),
    materials: roundCents(b.materials),
    travel: roundCents(b.travel),
    equipment: roundCents(b.equipment),
    odcOther: roundCents(b.odcOther),
    odcTotal: roundCents(odcTotal(b)),
    subcontracts: roundCents(b.subcontracts),
    totalBeforeGna: roundCents(b.totalBeforeGna),
    gna: roundCents(b.gna),
    totalEstCost: roundCents(b.totalEstCost),
    fee: roundCents(b.fee),
    totalPrice: roundCents(b.totalPrice),
  };
}

export function budgetAsDisplay(r: BudgetResult): {
  periods: Array<Record<string, number | string>>;
  grand: Record<string, number | string>;
  workshare: Record<string, number>;
  realismFlags: RealismFlag[];
  rates: IndirectRates;
} {
  return {
    periods: r.periods.map(periodAsDisplay),
    grand: periodAsDisplay(r.grand),
    workshare: {
      sbcWorkPct: roundCents(r.workshare.sbcWorkPct),
      subcontractShareOfPrice: roundCents(r.workshare.subcontractShareOfPrice),
      researchInstitutionShareOfPrice: roundCents(r.workshare.researchInstitutionShareOfPrice),
    },
    realismFlags: r.realismFlags,
    rates: r.rates,
  };
}
