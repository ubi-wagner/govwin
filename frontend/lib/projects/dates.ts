/**
 * Dates that come back from the database as `Date`, not as strings.
 *
 * ── THE BUG THIS EXISTS FOR, WHICH EVERY AUTOMATED LENS PASSED ───────────────────────────────
 * postgres.js returns a `date` column as a JavaScript `Date`. The workspace page treated one as an
 * ISO string:
 *
 *     String(milestone.forecastDate).slice(0, 10)   // "Tue Apr 28", not "2026-04-28"
 *     Date.parse("Tue Apr 28" + "T00:00:00Z")       // NaN
 *
 * Which rendered, on a live page, as:
 *
 *     Kickoff and SOW agreed              met  NaN days early against baseline
 *     0001  Base period …   Tue Apr 28 → Wed Apr 28
 *
 * — a variance of NaN labelled "early" (because `NaN > 0` is false, so the ternary picked the
 * cheerful branch), and a period of performance whose start and end read the same because a
 * ten-character slice of a `Date`'s string form cuts before the year.
 *
 * `verify-surfaces` scored the page clean. `verify-api-contract` scored it clean. `verify-ui-vs-db`
 * scored it clean. It was found by LOOKING AT THE SCREENSHOT, which is exactly the case
 * docs/UI_ATLAS.md exists for: *a page can answer 200, return a textbook envelope, carry no text
 * any matcher knows, and be visibly broken.*
 *
 * So date handling lives here, accepts whatever the driver hands back, and is unit-tested against
 * a real `Date` — because a test that only feeds it strings would have passed too.
 */

/**
 * A `YYYY-MM-DD` string from a Date or an ISO string, or null. Never a partial slice.
 *
 * ── WHY THE STRING FORM IS PATTERN-CHECKED AND NOT JUST HANDED TO `new Date()` ───────────────
 * `new Date('Tue Apr 28')` does not throw and is not Invalid Date — Node parses it and **invents a
 * year**. So a value that came from the very bug this file exists for would be accepted here and
 * turned into a confident, wrong date. The unit test caught exactly that on the first version of
 * this function.
 *
 * A `Date` instance is trusted (the driver produced it); a string must look like an ISO date or
 * datetime. Anything else is null.
 */
const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/;

export function isoDate(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else {
    const str = String(value);
    if (!ISO_SHAPE.test(str)) return null;
    d = new Date(str);
  }
  if (Number.isNaN(d.getTime())) return null;
  // UTC, deliberately: a `date` column has no time zone, and rendering it in local time moves it a
  // day either side of midnight for half the world.
  return d.toISOString().slice(0, 10);
}

/**
 * Whole days from `from` to `to`, or null when either is missing or unparseable.
 *
 * **null, not 0, and not NaN.** A milestone with no baseline has no variance — that is a different
 * fact from "on time", and the two must not render the same. NaN is worse than either: it survives
 * a `!== 0` check and picks a branch.
 */
export function daysBetween(from: unknown, to: unknown): number | null {
  const a = isoDate(from);
  const b = isoDate(to);
  if (a === null || b === null) return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

/** How a variance reads to a person. `null` in, nothing rendered. */
export function varianceLabel(days: number | null): { text: string; late: boolean } | null {
  if (days === null || days === 0) return null;
  return days > 0
    ? { text: `${days} day${days === 1 ? '' : 's'} late against baseline`, late: true }
    : { text: `${-days} day${days === -1 ? '' : 's'} early against baseline`, late: false };
}
