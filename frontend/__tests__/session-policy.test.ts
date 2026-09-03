/**
 * THE TWO BOUNDS A SESSION HAS, AND THE FOUR WAYS A BOUND GETS WRITTEN WRONG.
 *
 * Measured behaviour before this shipped (`scripts/probe-session-lifecycle.mts`): the 8-hour
 * `maxAge` is SLIDING — every request re-signs the cookie — so an active session never ended, and
 * the presence heartbeat renewed the session of the one population that most needed a bound.
 *
 * These cases pin the properties that make the fix real rather than nominal. Each one is a way a
 * session bound can be present in the code and absent in effect.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  sessionEndReason, idleLimitFor, ABSOLUTE_MAX_MS, IDLE_MS, IDLE_DEFAULT_MS, HOUR, MINUTE,
} from '@/lib/session-policy';

const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);

describe('the absolute cap — the bound that activity cannot extend', () => {
  it('a session younger than the cap continues, however recently it was used', () => {
    expect(sessionEndReason({ startedAt: NOW - 11 * HOUR, lastSeenAt: NOW }, 'rfp_admin', NOW))
      .toBeNull();
  });

  it('a session past the cap ends EVEN THOUGH it is being used right now', () => {
    // This is the whole point. Under the old behaviour this session was immortal: `lastSeenAt` is
    // `now`, so no idle rule would ever fire, and there was nothing else to fire.
    expect(sessionEndReason({ startedAt: NOW - 13 * HOUR, lastSeenAt: NOW }, 'rfp_admin', NOW))
      .toBe('absolute');
  });

  it('exactly at the cap ends — a boundary written as > rather than >= grants an extra request', () => {
    expect(sessionEndReason({ startedAt: NOW - ABSOLUTE_MAX_MS, lastSeenAt: NOW }, 'rfp_admin', NOW))
      .toBe('absolute');
  });

  it('a start stamp in the FUTURE is refused, not trusted', () => {
    // A forged or corrupt claim that says "I started tomorrow" would otherwise buy an unbounded
    // session — the arithmetic makes `now - startedAt` negative, which passes every check.
    expect(sessionEndReason({ startedAt: NOW + 2 * HOUR, lastSeenAt: NOW }, 'rfp_admin', NOW))
      .toBe('absolute');
  });

  it('a stamp a few seconds ahead is tolerated — clock skew is not an attack', () => {
    expect(sessionEndReason({ startedAt: NOW + 30_000, lastSeenAt: NOW }, 'rfp_admin', NOW))
      .toBeNull();
  });
});

describe('the idle window — the bound that walking away costs', () => {
  it('an admin idles out sooner than a tenant, because the blast radius is bigger', () => {
    expect(IDLE_MS.rfp_admin).toBeLessThan(IDLE_MS.tenant_admin);
  });

  it('an idle session past its role window ends', () => {
    const idle = IDLE_MS.tenant_admin + MINUTE;
    expect(sessionEndReason({ startedAt: NOW - idle, lastSeenAt: NOW - idle }, 'tenant_admin', NOW))
      .toBe('idle');
  });

  it('the same gap does NOT end an admin session by the tenant rule, and vice versa', () => {
    // A single global idle number would either be too loose for admins or too tight for customers.
    const gap = 3 * HOUR;
    expect(sessionEndReason({ startedAt: NOW - gap, lastSeenAt: NOW - gap }, 'rfp_admin', NOW))
      .toBe('idle');
    expect(sessionEndReason({ startedAt: NOW - gap, lastSeenAt: NOW - gap }, 'tenant_admin', NOW))
      .toBeNull();
  });

  it('an unknown role gets the SHORTEST window, not the longest', () => {
    // Fail closed. A role added later, or a corrupted claim, must not widen its own bound.
    expect(idleLimitFor('nonsense')).toBe(IDLE_DEFAULT_MS);
    expect(idleLimitFor(undefined)).toBe(IDLE_DEFAULT_MS);
    expect(idleLimitFor(null)).toBe(IDLE_DEFAULT_MS);
    expect(IDLE_DEFAULT_MS).toBe(Math.min(...Object.values(IDLE_MS)));
  });
});

describe('adoption — shipping this must not sign everybody out', () => {
  it('a token with no stamps continues, and is adopted rather than expired', () => {
    // Every session live at deploy time carries neither claim. Reading a missing `startedAt` as
    // "infinitely old" would end every one of them on the first request after the deploy — an
    // outage produced by a security control, which is how security controls get reverted.
    expect(sessionEndReason({}, 'tenant_admin', NOW)).toBeNull();
  });

  it('a half-stamped token is not ended by the claim it is missing', () => {
    expect(sessionEndReason({ startedAt: NOW - HOUR }, 'tenant_admin', NOW)).toBeNull();
    expect(sessionEndReason({ lastSeenAt: NOW - MINUTE }, 'tenant_admin', NOW)).toBeNull();
  });

  it('a non-numeric stamp is ignored rather than coerced', () => {
    // `Number(undefined)` is NaN and every NaN comparison is false, so a coercing implementation
    // would silently never expire. Typed checks are what make that impossible.
    expect(sessionEndReason({ startedAt: 'yesterday', lastSeenAt: null }, 'rfp_admin', NOW))
      .toBeNull();
  });
});

describe('the absolute cap outranks the idle window', () => {
  it('a session both stale AND past the cap reports `absolute`', () => {
    // The person is told the accurate thing. "Your session reached its maximum length" and "you
    // were signed out for inactivity" prompt different behaviour from the reader.
    expect(sessionEndReason(
      { startedAt: NOW - 20 * HOUR, lastSeenAt: NOW - 9 * HOUR }, 'rfp_admin', NOW,
    )).toBe('absolute');
  });
});

describe('the test-only cap override cannot become a hole', () => {
  // `vi.stubEnv` + `unstubAllEnvs`, NOT Object.defineProperty: `process.env` rejects a descriptor
  // that is not writable+enumerable, so the hand-rolled restore threw in `finally` and reported a
  // failure whose assertions had already passed.
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it('is ignored in production, whatever it says', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_CAP_MS_OVERRIDE', String(365 * 24 * HOUR));
    vi.resetModules();
    const fresh = await import('@/lib/session-policy');
    expect(fresh.ABSOLUTE_MAX_MS).toBe(12 * HOUR);
  });

  it('can only SHORTEN the cap, never widen it', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SESSION_CAP_MS_OVERRIDE', String(999 * HOUR));
    vi.resetModules();
    const wide = await import('@/lib/session-policy');
    expect(wide.ABSOLUTE_MAX_MS).toBe(12 * HOUR);        // clamped, never widened
  });

  it('but shortening IS allowed, which is what makes the live proof possible', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SESSION_CAP_MS_OVERRIDE', '25000');
    vi.resetModules();
    const short = await import('@/lib/session-policy');
    expect(short.ABSOLUTE_MAX_MS).toBe(25_000);
  });
});
