/**
 * The analytics visitor session, read from the browser — the one client-side half of the
 * attribution chain.
 *
 * ── WHY THIS EXISTS AS ITS OWN MODULE ────────────────────────────────────────────────────────
 * Migration 242 added `session_id` to `waitlist` and `applications`, migration 243 added
 * `contacts.first_session_id`, both capture API routes accept it, `lib/contacts.ts` records it and
 * `/admin/funnel` reads the whole chain end to end. All of that was built, unit-tested, and proven
 * by `drive-commercial-path` — which passes because THE DRIVE sends a session id.
 *
 * The two real public forms never did. `components/analytics/tracker.tsx` minted `_rfp_sid` into
 * `sessionStorage` on every page view, and nothing else in the tree ever read it back. So the
 * funnel would have reported "0 of N contacts carry a first-touch session" forever, correctly and
 * uselessly, on a chain that was complete at every layer except the three lines that feed it.
 *
 * That is the repository's most-repeated failure — a capability built and never exercised — and
 * the reason this is a shared module rather than two copies: a second capture form (a landing
 * page, an event sign-up) must not have to remember.
 *
 * ── WHY IT CAN RETURN null, AND WHY THAT IS FINE ─────────────────────────────────────────────
 * `sessionStorage` throws in some privacy modes and is empty on a first paint before the tracker
 * has run. A missing session is a LEGAL state all the way down — the columns are nullable, and the
 * funnel counts such a person in its un-attributed row rather than guessing. Never fabricate one:
 * an invented attribution is indistinguishable from a real one and silently poisons every campaign
 * number computed from the chain (migration 242).
 */

/** The key `components/analytics/tracker.tsx` writes. One name, one place. */
export const VISITOR_SESSION_KEY = '_rfp_sid';

/**
 * The current visitor session id, or null when there isn't one.
 *
 * Never throws: a capture form must submit even when storage is unavailable, and losing one
 * attribution is acceptable where refusing somebody's application is not.
 */
export function visitorSessionId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const sid = window.sessionStorage.getItem(VISITOR_SESSION_KEY);
    return sid && sid.trim() ? sid.trim().slice(0, 120) : null;
  } catch {
    // Private browsing, or a browser configured to block site data.
    return null;
  }
}
