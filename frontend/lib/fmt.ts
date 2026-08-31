/**
 * Deterministic formatting for anything a CLIENT component renders — a zero-import leaf.
 *
 * ── THE DEFECT, WHICH IS THE CLOCK BUG'S SIBLING ─────────────────────────────────────────────
 * `components/ui/time-ago.tsx` exists because reading `Date.now()` during render makes a client
 * component's output a function of WHEN it rendered, so server and client disagree, React throws
 * #418, and hydration fails for the whole subtree while the route answers HTTP 200. Eight
 * occurrences are on the record.
 *
 * The ninth was found by the atlas sweep on `/admin/analytics`, and it reads no clock at all:
 *
 *     new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', … })
 *
 * `undefined` means "use the ambient locale", and there are TWO ambients. The server formats in
 * Node's locale and the container's timezone (UTC here); the browser formats in the visitor's. The
 * output is a function of WHERE it rendered instead of when — same mismatch, same #418, same
 * whole-page failure at HTTP 200, and invisible to any check that reads a status code.
 *
 * Dates carry both hazards (locale AND timezone); numbers carry one, and it is not small — 250000
 * is "250,000" in en-US and "250.000" in de-DE, which is a different number to a reader.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────
 * Anything a client component renders on first paint must format IDENTICALLY on both sides. That
 * means pinning the locale and, for dates, the timezone. These helpers do exactly that and nothing
 * else, so a call site reads the same as the unsafe form it replaces.
 *
 * ⚠️ A pinned timezone means a customer in Denver sees a UTC calendar date. That is deliberate: a
 * government close date IS a fixed calendar date, not a moment, and rendering "closes Sep 19" to
 * one customer and "Sep 20" to another is worse than rendering one true date to everyone. Where a
 * genuine local time matters, render it after mount (`useClientNow`), where there is nothing to
 * mismatch against.
 */

/** The one locale, in one place. Changing it changes every surface — which is the point. */
const LOCALE = 'en-US';

/** `2026-09-19` → `Sep 19, 2026`. Same string on the server and in every browser. */
export function fmtDate(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleDateString(LOCALE, {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/** `Sep 19, 2026, 02:30 PM UTC`. The suffix is not decoration — without it the pinned zone is a
 *  silent lie to anyone not in it. */
export function fmtDateTime(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return '—';
  return `${new Date(t).toLocaleString(LOCALE, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC',
  })} UTC`;
}

/** Short form for dense tables: `Sep 19, 02:30 PM UTC` — no year. */
export function fmtShortDateTime(v: string | number | Date | null | undefined): string {
  if (v === null || v === undefined || v === '') return '—';
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return '—';
  return `${new Date(t).toLocaleString(LOCALE, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC',
  })} UTC`;
}

/** `250000` → `250,000`. Locale-pinned, so a grouped number means the same thing to every reader. */
export function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return n.toLocaleString(LOCALE);
}

/** `250000` → `$250,000`. */
export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString(LOCALE)}`;
}
