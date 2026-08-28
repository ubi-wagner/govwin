/**
 * Did the drafted narrative invent a number?
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * P1's status report is correct BY CONSTRUCTION: every figure in it is read off a row, and the
 * builder is a pure function with no way to state something the database did not say. That property
 * is the whole reason the report can be handed to a customer.
 *
 * An agent writing the narrative around those tables can destroy it in one sentence. "We are
 * approximately 65% through the period" reads perfectly, sits beside a table that says 40%, and
 * nothing in the document disagrees with it — the reader simply believes whichever they read first.
 *
 * A prompt asking the model not to do that is necessary and is not sufficient. This is the check
 * that makes it a rule: **every number in the prose must be one the system computed.** It is
 * deterministic, it runs on the frontend before a person is ever offered the text, and it does not
 * ask the model's opinion of its own output.
 *
 * ── WHAT IT DELIBERATELY ALLOWS ──────────────────────────────────────────────────────────────
 * Small integers up to `SMALL_INT_CEILING` pass unchecked. "Two milestones slipped" and "the first
 * of three phases" are ordinary English, and rejecting them would make the check unusable — which
 * is the fastest way for a guard to be switched off. The figures that matter — money, percentages,
 * day counts, anything large — are exactly the ones a reader would act on, and those must match.
 *
 * ── AND WHY IT REPORTS RATHER THAN STRIPS ────────────────────────────────────────────────────
 * It returns the offending values instead of silently deleting them. A sentence with its number
 * removed is a worse artefact than no sentence: it reads as finished and says nothing. The caller
 * refuses the draft and says which figure was invented.
 */

/** Below this, a bare integer is treated as ordinary prose ("two of three phases"). */
export const SMALL_INT_CEILING = 12;

export interface FidelityResult {
  ok: boolean;
  /** Numbers in the prose that no computed figure accounts for. */
  invented: string[];
  /** How many numeric tokens were checked at all — so a green result can be told from an empty one. */
  checked: number;
}

/**
 * Every numeric token in a string, normalised.
 *
 * `$1,100,000` → `1100000`; `43.3%` → `43.3`; `(14)` → `14`. Currency symbols, thousands separators
 * and trailing units are stripped so the comparison is between VALUES and not between renderings —
 * the report writes `$750,000` and the narrative may reasonably write `750,000` or `$750K`… which
 * is exactly why `750K` is NOT normalised to 750000 below: guessing at an abbreviation is how a
 * check starts approving numbers it did not verify.
 */
export function numbersIn(text: string): string[] {
  const out: string[] = [];
  // Digits with optional thousands separators and an optional decimal tail.
  for (const m of String(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, '');
    if (raw === '') continue;
    out.push(raw);
  }
  return out;
}

/** Canonical form of a figure, so `40`, `40.0` and `$40` compare equal. */
function canon(v: string | number): string {
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return String(v).trim();
  // Trailing zeros dropped: 43.30 and 43.3 are the same figure.
  return String(Number(n.toFixed(4)));
}

/**
 * Check drafted prose against the figures the system actually computed.
 *
 * `allowed` is every value the report is entitled to state — pass the rollup's own numbers, the
 * variance days, the billing position. Anything numeric in `narrative` that is not in that set, and
 * is not a small integer, is reported.
 */
export function checkNarrativeFidelity(
  narrative: string,
  allowed: Array<string | number | null | undefined>,
): FidelityResult {
  const permitted = new Set<string>();
  for (const a of allowed) {
    if (a === null || a === undefined || a === '') continue;
    permitted.add(canon(a));
    // A figure may legitimately be written without its decimal tail — the report renders money to
    // whole dollars and the prose may too. The reverse is NOT added: a narrative may drop precision
    // the system had, never add precision it did not.
    const n = Number(String(a).replace(/[^0-9.\-]/g, ''));
    if (Number.isFinite(n)) permitted.add(canon(Math.round(n)));
  }

  // A YEAR is not a claim about the project. Dates are rendered by the deterministic builder and a
  // narrative naming the month is ordinary writing.
  const isYear = (v: string) => /^(19|20)\d{2}$/.test(v);

  const invented: string[] = [];
  let checked = 0;
  // Iterating the RAW matches, not the normalised ones: what gets reported has to be the string the
  // person can find in their own text. "512000 is not a computed figure" sends them looking for
  // something they never typed; "512,000" is the thing on the page.
  for (const m of String(narrative).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const tok = m[0];
    const c = canon(tok);
    const asNum = Number(c);
    if (Number.isFinite(asNum) && Number.isInteger(asNum) && Math.abs(asNum) <= SMALL_INT_CEILING) continue;
    if (isYear(tok)) continue;
    checked++;
    if (!permitted.has(c) && !invented.includes(tok)) invented.push(tok);
  }
  return { ok: invented.length === 0, invented, checked };
}

/**
 * Collect every figure a status narrative is entitled to state, from the same inputs the
 * deterministic report was built from.
 *
 * Deliberately generous about WHAT is allowed and strict about where it came from: it walks the
 * supplied objects rather than listing fields by hand, because a hand-list falls behind the report
 * and starts rejecting figures that are genuinely on the page — and a guard that cries wolf is one
 * somebody turns off.
 */
export function allowedFigures(...sources: unknown[]): string[] {
  const out = new Set<string>();
  const walk = (v: unknown, depth = 0) => {
    if (depth > 6 || v === null || v === undefined) return;
    if (typeof v === 'number') { out.add(canon(v)); return; }
    if (typeof v === 'string') {
      // A string field may itself BE a figure ('750000.00') or contain them ('1 of 3 accepted').
      for (const n of numbersIn(v)) out.add(canon(n));
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    if (typeof v === 'object') { for (const x of Object.values(v as object)) walk(x, depth + 1); }
  };
  for (const s of sources) walk(s);
  return [...out];
}
