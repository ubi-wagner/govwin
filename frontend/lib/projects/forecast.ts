/**
 * Estimate at completion, and what it costs to be honest about it (A5).
 *
 * ── WHY THIS IS ARITHMETIC AND NOT AN AGENT ──────────────────────────────────────────────────
 * EAC is spend-to-date divided by the fraction of work complete. It is a formula with a name and a
 * standard, and a model asked to produce it would be producing a number nobody could check —
 * against the one rule this capability keeps: *a confident number you did not read is a lie.*
 *
 * A5 was filed with the agent work and belongs with the measures, next to the inputs that feed it.
 * The same call as A3.
 *
 * ── THE HARD PART IS NOT THE FORMULA, IT IS THE DENOMINATOR ──────────────────────────────────
 * "Percent complete" is exactly the number `rollup.ts` refuses to produce, because cost, schedule
 * and deliverables disagree and averaging them destroys the signal. So EAC does not get a blended
 * one: it is computed **once per measure**, and the answers are reported side by side.
 *
 * Three EACs that disagree is not a failure of the calculation. It is the finding — "on the
 * deliverables we have accepted this will land at $1.4m; on schedule elapsed, $2.1m" is the
 * sentence a programme manager needs, and one averaged number destroys it while looking tidier.
 *
 * ── AND A MEASURE WITH NO DENOMINATOR PRODUCES NO ESTIMATE ───────────────────────────────────
 * `null`, never a number. An EAC computed from a percent-complete of zero is infinity; an EAC
 * computed from a percent-complete nobody measured is a fabrication with a currency symbol on it,
 * which is worse than a blank because it looks like an answer.
 */

/** The basis a given estimate was computed on — reported with the number, never separated from it. */
export type EacBasis = 'cost' | 'schedule' | 'deliverables';

export interface Estimate {
  basis: EacBasis;
  /** Estimate at completion. `null` when the basis has no denominator to divide by. */
  eac: number | null;
  /** Estimate to complete — what is left. `null` for the same reason. */
  etc: number | null;
  /** Against the frozen baseline. Negative is an overrun. `null` without a baseline. */
  varianceAtCompletion: number | null;
  /** The percent-complete this used, so a reader can see what it divided by. */
  percentComplete: number | null;
  /** Why there is no number, when there is none. */
  unavailable: string | null;
}

export interface ForecastInputs {
  /** Money actually spent: other-direct plus APPROVED labour. */
  actualCost: number;
  /** The current plan's total. */
  plannedCost: number | null;
  /** What was promised at baseline — frozen (mig 229). */
  baselineCost: number | null;
  costPct: number | null;
  schedulePct: number | null;
  deliverablesPct: number | null;
}

/** Round to the cent, so two estimates from the same inputs are the same number. */
const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * One estimate, on one basis.
 *
 * EAC = actual ÷ (percent complete). ETC = EAC − actual. Variance at completion = baseline − EAC,
 * so a NEGATIVE variance is an overrun — the same sign convention as schedule variance elsewhere in
 * this capability, where positive is late.
 */
export function estimateOn(basis: EacBasis, pct: number | null, inputs: ForecastInputs): Estimate {
  const none = (why: string): Estimate => ({
    basis, eac: null, etc: null, varianceAtCompletion: null, percentComplete: pct, unavailable: why,
  });

  if (pct === null) {
    return none('That measure has no denominator, so there is nothing to project from.');
  }
  if (pct <= 0) {
    // Dividing by zero is infinity, and rendering "∞" or a huge number would be read as a real
    // forecast. Nothing has happened yet; say that.
    return none('No progress recorded on this measure yet — a projection would be division by zero.');
  }
  if (inputs.actualCost <= 0) {
    return none('Nothing has been spent yet, so there is nothing to extrapolate.');
  }

  const eac = cents(inputs.actualCost / (pct / 100));
  const etc = cents(eac - inputs.actualCost);
  // Against the BASELINE, not the current plan: the plan may have been rebaselined, and measuring
  // a forecast against a number that moved with it would report zero variance forever.
  const vac = inputs.baselineCost === null ? null : cents(inputs.baselineCost - eac);

  return { basis, eac, etc, varianceAtCompletion: vac, percentComplete: pct, unavailable: null };
}

export interface Forecast {
  estimates: Estimate[];
  /** True when the available estimates disagree by more than `SPREAD_THRESHOLD`. */
  measuresDisagree: boolean;
  /** The widest gap between two estimates, or null when fewer than two exist. */
  spread: number | null;
}

/**
 * How far apart two estimates must be before the disagreement is worth pointing at.
 *
 * 20% of the lower figure. Small differences between bases are normal and flagging them would make
 * the signal meaningless; a fifth is the point at which "which basis are we using?" stops being
 * pedantry and becomes the question.
 */
export const SPREAD_THRESHOLD = 0.2;

/**
 * All three estimates, side by side, and whether they disagree.
 *
 * They are NOT combined. `rollup.ts` refuses to blend its three measures for the same reason, and
 * an EAC is only as meaningful as the percent-complete underneath it — so the basis travels with
 * every number.
 */
export function forecast(inputs: ForecastInputs): Forecast {
  const estimates = [
    estimateOn('cost', inputs.costPct, inputs),
    estimateOn('schedule', inputs.schedulePct, inputs),
    estimateOn('deliverables', inputs.deliverablesPct, inputs),
  ];

  const values = estimates.map((e) => e.eac).filter((v): v is number => v !== null);
  if (values.length < 2) {
    return { estimates, measuresDisagree: false, spread: null };
  }
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return {
    estimates,
    spread: cents(hi - lo),
    // Relative to the LOWER figure, so the threshold means the same thing on a $50k contract and a
    // $50m one.
    measuresDisagree: lo > 0 && (hi - lo) / lo > SPREAD_THRESHOLD,
  };
}

/**
 * The sentence a programme manager would write, or null when there is nothing to say.
 *
 * Deliberately refuses to pick a "headline" EAC. Naming one would answer the question the spread is
 * asking, and it is not this function's question to answer.
 */
export function forecastNote(f: Forecast): string | null {
  const usable = f.estimates.filter((e) => e.eac !== null);
  if (usable.length === 0) return null;
  if (!f.measuresDisagree) return null;
  const parts = usable.map(
    (e) => `${e.basis} ${e.eac!.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`,
  );
  return `The bases disagree: ${parts.join(' · ')}. Which one is right depends on whether the work `
    + 'remaining looks more like the money spent, the time elapsed, or the items delivered.';
}
