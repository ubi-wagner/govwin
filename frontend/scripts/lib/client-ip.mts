/**
 * EVERY SIMULATED PERSON GETS THEIR OWN CLIENT ADDRESS.
 *
 * `middleware.ts` rate-limits `/api/auth/*` at **20 requests per 15 minutes**, keyed on
 * `${clientIp}:/api/auth`, where `clientIp` is read from `x-real-ip` / `x-forwarded-for` and falls
 * back to the literal string `'unknown'`. Nothing in this sandbox sits in front of the app to set
 * those headers, so — before this file existed — **every browser in every drive shared one bucket
 * named `unknown`**, and the whole 27-drive suite had a combined budget of twenty auth calls per
 * quarter hour. A login costs several (csrf + callback), and each `GET /api/auth/session` costs one.
 *
 * What that produced was not a red suite. It was worse: the drives that ran EARLY passed, the drives
 * that ran LATE got `429 RATE_LIMITED` on every session read, the harness quietly turned that into an
 * empty session object, and sixteen assertions across `pin` and `identity-deeplink` reported
 * `role=undefined tenant=undefined` as **product failures**. A confident, wrong finding — the exact
 * failure mode the "instrument before the finding" rule exists to catch.
 *
 * The fix is not to disable the limiter or to raise its ceiling. The limiter is the contract the
 * system HAS, and a production deployment sits behind a proxy that sets these headers per client.
 * The fix is for the harness to stop pretending that a dozen different simulated people are one
 * machine: a browser context is one person's browser, so each one declares its own address. The
 * limiter still runs, still enforces 20-per-15-minutes, and now enforces it per simulated person —
 * which is what it was written to do.
 *
 * Verified: with the shared `unknown` bucket exhausted (`GET /api/auth/session` → 429), the same
 * request carrying a fresh `x-real-ip` returns 200, through both `page.goto` and `context.request`.
 *
 * The addresses are RFC1918 and namespaced by pid so two drives running at once cannot collide.
 */

/** Per-process, so concurrent drives occupy different /24s. */
const OCTET_B = (process.pid >> 8) & 0xff;
const OCTET_C = process.pid & 0xff;
let seq = 0;

/**
 * The next simulated client address. Wraps at 250 rather than running off the end of the octet —
 * a drive making 250 browser contexts has a different problem than rate limiting.
 */
export function nextClientIp(): string {
  seq = (seq % 250) + 1;
  return `10.${OCTET_B}.${OCTET_C}.${seq}`;
}

/** Headers declaring a fresh simulated client. Spread into `browser.newContext({...})`. */
export function clientHeaders(): Record<string, string> {
  return { 'x-real-ip': nextClientIp() };
}
