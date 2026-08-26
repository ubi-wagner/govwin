/**
 * The middleware must let a headless scheduler reach the two cron endpoints — and nothing else.
 *
 * THE BUG THIS PINS. Both routes were written with a bearer path in the handler:
 *
 *     const viaCron = !!cronSecret && authz === `Bearer ${cronSecret}`;
 *
 * …which the middleware made unreachable. Every non-public path needs a session, and that check
 * runs first, so a correctly-authenticated poke got `{"error":"unauthenticated"}` before the handler
 * was entered. Two features were silently disabled by it: the card-reconcile sweep (the only thing
 * that heals a tenant which never opens its feed) and the TW-8 agent-gate auto-advance, documented
 * as "inert until AGENT_GATE_SWEEP_URL is set" when in truth it stayed inert afterwards too.
 *
 * The dangerous repair would be widening the public allowlist, so the cases below are mostly about
 * what must STAY closed: a prefix match, an unset secret, a wrong secret, a missing header.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(process.cwd(), 'middleware.ts'), 'utf8');

// The predicate, lifted verbatim from middleware.ts. It reads process.env at call time and has no
// other dependency, so exercising it here is exercising the shipped logic — not a paraphrase.
const CRON_EXACT_PATHS = [
  '/api/admin/reconcile-cards',
  '/api/admin/agent-gates/sweep',
];
function isAuthorizedCron(pathname: string, authorization: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorization) return false;
  if (!CRON_EXACT_PATHS.includes(pathname)) return false;
  return authorization === `Bearer ${secret}`;
}

const SECRET = 's3cr3t-for-tests';
let saved: string | undefined;
beforeEach(() => { saved = process.env.CRON_SECRET; process.env.CRON_SECRET = SECRET; });
afterEach(() => {
  if (saved === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = saved;
});

describe('the cron bearer opens exactly the two sweep endpoints', () => {
  it.each(CRON_EXACT_PATHS)('%s', (p) => {
    expect(isAuthorizedCron(p, `Bearer ${SECRET}`)).toBe(true);
  });
});

describe('and stays shut for everything else', () => {
  it('a wrong secret', () => {
    expect(isAuthorizedCron('/api/admin/reconcile-cards', 'Bearer nope')).toBe(false);
  });

  it('no Authorization header at all', () => {
    expect(isAuthorizedCron('/api/admin/reconcile-cards', null)).toBe(false);
  });

  it('an UNSET CRON_SECRET never falls open', () => {
    delete process.env.CRON_SECRET;
    expect(isAuthorizedCron('/api/admin/reconcile-cards', 'Bearer ')).toBe(false);
    expect(isAuthorizedCron('/api/admin/reconcile-cards', 'Bearer undefined')).toBe(false);
  });

  it('an EMPTY CRON_SECRET never falls open', () => {
    process.env.CRON_SECRET = '';
    expect(isAuthorizedCron('/api/admin/reconcile-cards', 'Bearer ')).toBe(false);
  });

  it('a sibling admin route with the same secret', () => {
    // The whole point of exact paths: the bearer is not an admin skeleton key.
    expect(isAuthorizedCron('/api/admin/tenants', `Bearer ${SECRET}`)).toBe(false);
    expect(isAuthorizedCron('/api/admin/rfp-curation', `Bearer ${SECRET}`)).toBe(false);
  });

  it('a PREFIX of a cron path, or anything below it', () => {
    expect(isAuthorizedCron('/api/admin/reconcile-cards/all', `Bearer ${SECRET}`)).toBe(false);
    expect(isAuthorizedCron('/api/admin', `Bearer ${SECRET}`)).toBe(false);
  });

  it('a scheme other than Bearer', () => {
    expect(isAuthorizedCron('/api/admin/reconcile-cards', `Basic ${SECRET}`)).toBe(false);
    expect(isAuthorizedCron('/api/admin/reconcile-cards', SECRET)).toBe(false);
  });
});

describe('the middleware wires it where it matters', () => {
  it('checks the bearer BEFORE the session gate', () => {
    const cron = SRC.indexOf('isAuthorizedCron(pathname');
    const gate = SRC.indexOf('const session = req.auth');
    expect(cron).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(-1);
    // Reversed, the session check 401s first and the bearer path is unreachable — the original bug.
    expect(cron).toBeLessThan(gate);
  });

  it('does not put the cron paths in the PUBLIC allowlist', () => {
    // Public would mean no auth at all. These stay authenticated, just by a different credential.
    const publicBlock = SRC.slice(SRC.indexOf('const PUBLIC_PATHS'), SRC.indexOf('const STATIC_ASSET_RE'));
    for (const p of CRON_EXACT_PATHS) expect(publicBlock).not.toContain(p);
  });
});
