/**
 * Contract money, as a person reads it.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * postgres.js returns `numeric` as a STRING, so a funded amount arrives as `"1100000.00"` and
 * rendering it directly puts exactly that on the page:
 *
 *     FUNDED
 *     1100000.00                    ← is that $1.1M, or $11,000.00 with a stray zero?
 *     805000 of 1750000 spent
 *
 * Every number was correct. Every lens was green — `verify-ui-vs-db` compares the *value* the page
 * states to the value the table holds, and those matched. It was found by opening the screenshot,
 * which is the second time in this capability that the picture caught what the assertions could not.
 *
 * On a page about a federal contract, the funded amount is the number a reader scans for first, and
 * a wall of digits with no separator and no currency is not a presentation choice — it is a number
 * the reader has to count on their fingers to trust.
 *
 * The house convention is `lib/export/canvas-html.ts:172` — `$` plus `en-US` grouping, no cents.
 * Cents on a million-dollar CLIN are noise; the ledger keeps them, the page does not show them.
 */

/**
 * `"1100000.00"` → `"$1,100,000"`. Returns null for anything that is not a finite number, so a
 * caller renders an em-dash rather than `$NaN`.
 *
 * Accepts the string postgres.js actually hands back, a number, or a null — the same "take what the
 * driver gives you" contract as `isoDate`.
 */
const NUMERIC = /^-?\d+(?:\.\d+)?$/;

export function usd(value: unknown): string | null {
  // Only a number or a numeric STRING. Not `String(value)` — `Number(String([]))` is **0**, so an
  // empty array would render as "$0", and a confident zero on a funded amount is the exact failure
  // this codebase keeps fighting. The unit test caught it on the first version of this function.
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && NUMERIC.test(value.trim())) n = Number(value.trim());
  else return null;
  if (!Number.isFinite(n)) return null;
  const body = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `${n < 0 ? '-$' : '$'}${body}`;
}

/**
 * "$805,000 of $1,750,000 spent" — the sentence under the Cost measure.
 *
 * Both halves formatted or neither: `$805,000 of 1750000` is worse than leaving both raw, because
 * it looks deliberate.
 */
export function spentOf(actual: unknown, planned: unknown): string | null {
  const a = usd(actual);
  const p = usd(planned);
  if (a === null || p === null) return null;
  return `${a} of ${p} spent`;
}
