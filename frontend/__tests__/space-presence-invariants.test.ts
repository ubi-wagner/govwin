/**
 * THE ENTER AND THE EXIT MUST COME FROM ONE PLACE.
 *
 * The defect this guards is structural, not behavioural: `partner.entered` was emitted by a route
 * and `partner.exited` by a different route with `tenantId: null`; `shadow.descended` was emitted
 * by a client component's `useEffect` and `shadow.ascended` only by that component's button. Four
 * emitters, no pairing, and the exits went missing exactly when nobody pressed anything.
 *
 * `drive-space-presence.mts` proves the behaviour on a live box. This is the cheaper, earlier
 * guard: that no OTHER file has quietly started emitting half a pair again. A behavioural test
 * cannot catch that — a second emitter makes the events fire MORE, not less, so the drive would
 * still pass while the invariant was gone.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Every source file under the app/lib/components trees. */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(rel);
  }
  return out;
}
const SOURCES = ['app', 'lib', 'components'].flatMap((d) => walk(d));

/**
 * Strip comments before asking what a file DOES.
 *
 * This repo documents each defect at its own site, so a scan for a bug pattern otherwise finds the
 * CHANGELOG of that bug — reporting the most defects exactly where the most care was taken. Both
 * files below explain the old emit in prose directly above the code that replaced it.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const PAIRED = ['shadow.descended', 'shadow.ascended', 'partner.entered', 'partner.exited'];

describe('one writer owns both ends of a space-presence bracket', () => {
  it('lib/space-presence.ts is the only file that emits these four events', () => {
    const emitters = SOURCES.filter((f) => {
      const src = stripComments(read(f));
      // An emit is a `type:` on one of the four names. The event-LABEL table names them all as
      // keys and must not count — it renders them, it does not emit them.
      return PAIRED.some((t) => new RegExp(`type:\\s*['"\`]${t.replace('.', '\\.')}['"\`]`).test(src))
        || /EVENTS\s*\[\s*kind\s*\]\s*\.(enter|exit)/.test(src);
    });
    expect(emitters, `unexpected emitter(s): ${emitters.join(', ')}`).toEqual(['lib/space-presence.ts']);
  });

  it('every door declares BOTH halves — a new one cannot add only an enter', () => {
    const src = read('lib/space-presence.ts');
    const block = src.slice(src.indexOf('const EVENTS'), src.indexOf('const NAMESPACE'));
    const doors = [...block.matchAll(/(\w+):\s*\{\s*enter:\s*'([^']+)',\s*exit:\s*'([^']+)'\s*\}/g)];
    expect(doors.length, 'no door parsed — the shape changed').toBeGreaterThanOrEqual(2);
    for (const [, kind, enter, exit] of doors) {
      expect(enter, `${kind} has no enter`).toBeTruthy();
      expect(exit, `${kind} has no exit`).toBeTruthy();
      expect(enter, `${kind}: enter and exit are the same event`).not.toBe(exit);
    }
  });

  it('the exit is emitted with the tenant it left — never null', () => {
    const src = stripComments(read('lib/space-presence.ts'));
    // The close path emits `tenantId: p.tenantId`, read off the bracket row. The whole partner bug
    // was a literal `tenantId: null` on an exit, so that literal must not reappear here.
    expect(src).toMatch(/tenantId:\s*p\.tenantId/);
    expect(src).not.toMatch(/tenantId:\s*null/);
  });

  it('the two routes that used to emit directly now delegate', () => {
    for (const f of ['app/api/partner/exit/route.ts', 'app/api/partner/enter/route.ts',
                     'app/api/admin/shadow-transition/route.ts']) {
      const src = stripComments(read(f));
      expect(src, `${f} still emits directly`).not.toMatch(/emitEventSingle/);
      expect(src, `${f} does not use the seam`).toMatch(/(open|close)Presence/);
    }
  });

  it('the shadow banner no longer emits the descend — the server owns it', () => {
    // Its old dedupe was `sessionStorage`, which is per TAB: a second tab opened a bracket that
    // nothing would ever close. The modal stays (a new tab SHOULD be told again); the emit does not.
    const src = stripComments(read('components/portal/shadow-space-banner.tsx'));
    expect(src).not.toMatch(/post\(\s*['"]down['"]\s*\)/);
    expect(src, 'the explicit ascend is still wired').toMatch(/post\(\s*['"]up['"]\s*\)/);
  });
});

describe('the four ways out stay four distinct facts', () => {
  const REASONS = ['explicit', 'left_space', 'moved', 'timeout', 'signed_out'];

  it('the type, the CHECK constraint and the call sites agree', () => {
    const lib = read('lib/space-presence.ts');
    // The CHECK was widened by 247, so the live vocabulary is the LATER migration — reading only
    // 246 would pass while the database refused the fifth reason at runtime.
    const mig = read('../db/migrations/246_space_presence.sql')
      + read('../db/migrations/247_space_presence_signed_out.sql');
    for (const r of REASONS) {
      expect(lib, `${r} missing from the CloseReason type`).toContain(`'${r}'`);
      expect(mig, `${r} missing from the CHECK`).toContain(`'${r}'`);
    }
    // Each reason must actually be USED somewhere, or it is a vocabulary nobody writes — which is
    // how "closed" and "closed for a reason nobody recorded" become indistinguishable.
    const callers = ['app/portal/[tenantSlug]/layout.tsx', 'app/admin/layout.tsx',
                     'app/partner/page.tsx', 'app/api/partner/exit/route.ts',
                     'app/api/admin/shadow-transition/route.ts', 'lib/space-presence.ts',
                     'auth.ts']
      .map((f) => stripComments(read(f))).join('\n');
    for (const r of REASONS) expect(callers, `nothing ever closes with '${r}'`).toContain(`'${r}'`);
  });

  it('the sweep is bounded on both sides', () => {
    // Too eager and it evicts somebody who is merely reading, writing a departure into a customer's
    // trail that did not happen. Unbounded above and a typo silently disables it, restoring the bug.
    const src = stripComments(read('app/api/admin/space-presence/sweep/route.ts'));
    expect(src).toMatch(/Math\.min\(Math\.max\(/);
  });

  it('signing out closes EVERY bracket, with no exception', () => {
    // Sign-out can be pressed from INSIDE a customer's workspace, and at that instant the actor is
    // unambiguously gone. Waiting for the idle sweep would leave that company's trail asserting an
    // administrator was present at a moment when they had demonstrably logged out — a confident
    // wrong record, which is worse than a missing one.
    const src = stripComments(read('auth.ts'));
    expect(src, 'no signOut event').toMatch(/events:\s*\{[\s\S]*signOut/);
    expect(src).toMatch(/closePresence\([^)]*'signed_out'\)/);
    // No `exceptTenantId` on this path: there is no current tenant once the session is over.
    expect(src).not.toMatch(/'signed_out'\s*,\s*\{/);
  });

  it('session EXPIRY has no invented reason — the sweep records what was measured', () => {
    // Nothing fires when a JWT quietly expires; there is no request to observe. `timeout` says
    // "we stopped seeing them", which is true. An `expired` reason would assert a moment nobody
    // measured, and would make an inference look like a fact.
    const lib = read('lib/space-presence.ts');
    expect(lib).not.toMatch(/'expired'/);
  });

  it('the heartbeat can REFRESH a bracket but never open or reopen one', () => {
    // If a ping could open a bracket, a stale tab would be a way back into a customer's workspace
    // and the heartbeat would stop being a report and become an action. The guard is in the SQL:
    // an UPDATE scoped to `closed_at IS NULL` matches nothing when there is nothing open, and
    // cannot resurrect a row that is closed.
    const lib = read('lib/space-presence.ts');
    const fn = lib.slice(lib.indexOf('export async function touchPresence'),
                         lib.indexOf('export async function sweepStalePresence'));
    expect(fn, 'touchPresence must not INSERT').not.toMatch(/INSERT/i);
    expect(fn, 'must only touch open brackets').toMatch(/closed_at IS NULL/);
    expect(fn, 'must not clear closed_at').not.toMatch(/closed_at\s*=\s*NULL/i);
    // Throttled in SQL, not in JS: a too-frequent ping is a no-op at the index rather than a write.
    expect(fn).toMatch(/last_seen_at <\s*now\(\)/);
  });

  it('the heartbeat interval stays well inside the sweep floor', () => {
    // A ping slower than the idle floor would let the sweep evict a live actor between beats —
    // the false-departure defect the heartbeat exists to remove, reintroduced by a constant.
    const comp = read('components/portal/presence-heartbeat.tsx');
    const mins = Number(/INTERVAL_MS = (\d+)/.exec(comp)?.[1]);
    expect(mins, 'INTERVAL_MS shape changed').toBeGreaterThan(0);
    const floor = Number(/idleMinutes = (\d+)/.exec(read('lib/space-presence.ts'))?.[1]);
    expect(floor, 'sweep floor shape changed').toBeGreaterThan(0);
    expect(mins * 2, 'ping interval is not comfortably inside the sweep floor').toBeLessThan(floor);
  });

  it('the heartbeat is mounted ONLY for an outside actor', () => {
    // A normal customer session must ping nothing: it holds no bracket, so every request would be
    // a write that matches no row, on the busiest surface in the product.
    const layout = stripComments(read('app/portal/[tenantSlug]/layout.tsx'));
    expect(layout).toMatch(/\(isShadowAdmin \|\| isDescendedPartner\) && <PresenceHeartbeat/);
  });

  it('the oversight surface renders written sentences, not the raw enum', () => {
    // `left_space` is a database value. An operator console is milder than a customer page, but it
    // is still read by people, and the map costs one object (B136).
    const lib = read('lib/space-presence-oversight.ts');
    for (const r of ['explicit', 'left_space', 'moved', 'signed_out', 'timeout']) {
      expect(lib, `${r} has no written sentence`).toMatch(new RegExp(`${r}:\\s*'`));
    }
    // And it must not clip its tables: overflow-hidden on a rounded wrapper once made 63% of every
    // admin row unreachable at 390px, while the body-scroll invariant still answered "no".
    //
    // STRIPPED FIRST, and this test failed until it was: the page names the bad class in the
    // comment explaining why it does not use it. That is this repo's own lesson — a text search for
    // a bug pattern finds the CHANGELOG of that bug, so it reports the most defects exactly where
    // the most care was taken — and the test walked straight into it.
    const page = stripComments(read('app/admin/workspace-access/page.tsx'));
    expect(page).toMatch(/overflow-x-auto/);
    expect(page).not.toMatch(/overflow-hidden/);
  });

  it('the oversight page computes durations from Dates, and does not read the clock in a client', () => {
    // `timestamptz` arrives as a Date. `String(d).slice(0,10)` is "Tue Apr 28" and every arithmetic
    // on it is NaN — which RENDERS ("NaN days early" shipped). And a client component reading the
    // clock during render fails hydration while the route still answers 200 (React #418, eight
    // occurrences). This page is a server component by construction.
    const page = read('app/admin/workspace-access/page.tsx');
    expect(page, 'must not be a client component').not.toMatch(/^'use client'/m);
    const lib = read('lib/space-presence-oversight.ts');
    expect(lib, 'duration must come from getTime(), not a sliced string').toMatch(/getTime\(\)/);
    expect(lib).toMatch(/instanceof Date/);
  });

  it('the cron path is in the middleware allowlist, or the bearer never reaches the handler', () => {
    // Documented trap, three prior occurrences: middleware requires a session and runs FIRST, so a
    // correctly-authenticated poke 401s before the route's own bearer check is reached.
    expect(read('middleware.ts')).toContain("'/api/admin/space-presence/sweep'");
  });
});
