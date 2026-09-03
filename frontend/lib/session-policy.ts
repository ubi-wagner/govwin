/**
 * SESSION BOUNDS — how long a session may live, and how long it may sit idle.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
 * `auth.config.ts` said `session: { strategy: 'jwt', maxAge: 8 * 60 * 60 }`, and that line means
 * something different from what it looks like. Measured on a running box
 * (`scripts/probe-session-lifecycle.mts`), every request re-signs the cookie with a fresh 8-hour
 * deadline — a page render, an API route, and the presence heartbeat all moved it. The `updateAge`
 * throttle that would prevent that applies only to the DATABASE strategy; the JWT branch of
 * `@auth/core` re-signs unconditionally.
 *
 * So `maxAge` is an IDLE window, and **there was no absolute cap at all**: a session that keeps
 * being used never ends. Worse, `PresenceHeartbeat` is mounted only for an outside actor inside a
 * customer's workspace and pings every two minutes, so the one population that most needs a bound
 * was the one population guaranteed never to hit one.
 *
 * Two bounds, because they answer different questions and one cannot substitute for the other:
 *
 *   ABSOLUTE — measured from SIGN-IN, ignoring all activity. The only thing that bounds a session
 *              in the limit. A stolen token, a forgotten tab, a shared machine: all end.
 *   IDLE     — measured from the last request the person actually caused. This is what makes
 *              "I walked away" cost something, and it is deliberately SHORTER for actors who can
 *              see across companies.
 *
 * ── A ZERO-IMPORT LEAF, ON PURPOSE ───────────────────────────────────────────────────────────
 * `auth.config.ts` is imported by `middleware.ts`, which runs on the EDGE runtime. Anything reached
 * from here is pulled into that bundle, so this file imports nothing — not `lib/db`, not
 * `lib/rbac`. The role arrives as a plain string and is compared as one. Same reasoning as
 * `lib/event-namespaces.ts`, and the failure mode is the same: only `next build` catches it.
 */

/** Milliseconds. Exported so the probe asserts against the same numbers the callback enforces. */
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

/**
 * The hard ceiling on a session's life, from sign-in. Activity does not extend it.
 *
 * Twelve hours is one working day plus slack: long enough that nobody is signed out mid-task by the
 * cap (the idle window will always bite first for a person who is actually working), short enough
 * that a session cannot survive a night, a weekend, or a change of shift.
 */
const ABSOLUTE_MAX_DEFAULT_MS = 12 * HOUR;

/**
 * The cap, with a TEST-ONLY shortening hook.
 *
 * Proving that the cap ends a session that is in continuous use needs a running server and cannot
 * wait twelve hours (`scripts/prove-session-cap.mts`). So `SESSION_CAP_MS_OVERRIDE` shortens it —
 * and the guard is the whole point of the design:
 *
 *   · it may only ever make the cap SHORTER, never longer, so the variable cannot widen a bound;
 *   · it is ignored outright when `NODE_ENV === 'production'`.
 *
 * Both halves are needed. Without the first, a variable set to a year is a session with no cap and
 * no sign of one. Without the second, the hole is simply reachable — and a security control with an
 * environment-variable escape is a control that will eventually be escaped in the place it matters.
 * The sandbox runs `NODE_ENV=production` to emulate prod, so the proof runs against a dev server.
 */
export const ABSOLUTE_MAX_MS = (() => {
  if (process.env.NODE_ENV === 'production') return ABSOLUTE_MAX_DEFAULT_MS;
  const raw = Number(process.env.SESSION_CAP_MS_OVERRIDE);
  if (!Number.isFinite(raw) || raw <= 0) return ABSOLUTE_MAX_DEFAULT_MS;
  return Math.min(raw, ABSOLUTE_MAX_DEFAULT_MS);
})();

/**
 * How long a session may sit with no request before it ends.
 *
 * Two tiers, and the split is about BLAST RADIUS rather than seniority. A platform admin's session
 * can reach every customer's data, so an abandoned one is worth more to an attacker and is more
 * expensive to a customer than an abandoned tenant session, which reaches one company.
 *
 * NOTE this is enforced here rather than by shortening the cookie's `maxAge`, for two reasons: the
 * cookie has one value for everyone and cannot vary by role, and a cookie that expires takes the
 * token with it, so the app could never tell "idled out" from "never signed in" — and those need
 * different words on the login screen.
 */
export const IDLE_MS: Record<string, number> = {
  master_admin: 2 * HOUR,
  rfp_admin: 2 * HOUR,
  partner_admin: 4 * HOUR,
  tenant_admin: 4 * HOUR,
  tenant_user: 4 * HOUR,
  partner_user: 4 * HOUR,
};

/** The fallback is the SHORTEST window, not the longest: an unrecognised role is not a licence. */
export const IDLE_DEFAULT_MS = 2 * HOUR;

export function idleLimitFor(role: unknown): number {
  return typeof role === 'string' && role in IDLE_MS ? IDLE_MS[role] : IDLE_DEFAULT_MS;
}

/** Why a session ended. Carried to the login screen so a person is told which one happened. */
export type SessionEndReason = 'absolute' | 'idle';

export interface SessionClock {
  /** ms since epoch when this session was established. Set once, at sign-in, never refreshed. */
  startedAt?: unknown;
  /** ms since epoch of the last request. Advanced on every token read. */
  lastSeenAt?: unknown;
}

/**
 * Should this session end now?  Returns the REASON, or null to continue.
 *
 * ── WHY A MISSING STAMP IS NOT AN EXPIRY ─────────────────────────────────────────────────────
 * Tokens issued before this shipped carry neither claim. Treating a missing `startedAt` as
 * "infinitely old" would sign out every logged-in user the moment this deploys — a self-inflicted
 * outage dressed as a security control. They are adopted instead: the caller stamps the claims and
 * the bounds start from that moment. The window during which an old token is unbounded is one
 * request long.
 */
export function sessionEndReason(
  clock: SessionClock,
  role: unknown,
  now: number,
): SessionEndReason | null {
  const startedAt = typeof clock.startedAt === 'number' ? clock.startedAt : null;
  const lastSeenAt = typeof clock.lastSeenAt === 'number' ? clock.lastSeenAt : null;

  // A clock from the future is a corrupt or forged claim, not a fresh session. Refuse it rather
  // than trusting it — the alternative is a token that grants an unbounded session by claiming to
  // have started tomorrow.
  if (startedAt !== null && startedAt > now + MINUTE) return 'absolute';
  if (startedAt !== null && now - startedAt >= ABSOLUTE_MAX_MS) return 'absolute';
  if (lastSeenAt !== null && now - lastSeenAt >= idleLimitFor(role)) return 'idle';
  return null;
}
