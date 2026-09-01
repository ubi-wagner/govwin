/**
 * A PUBLIC CAPTURE FORM MUST SEND THE VISITOR SESSION, OR THE WHOLE FUNNEL IS FED BY NOTHING.
 *
 * ── WHAT THIS GUARDS, AND HOW IT WAS FOUND ───────────────────────────────────────────────────
 * The attribution chain is five layers deep: `components/analytics/tracker.tsx` mints `_rfp_sid`
 * into sessionStorage → the capture form posts it → migration 242's `session_id` column stores it
 * → migration 243's `contacts.first_session_id` carries the first touch → `/admin/funnel` joins
 * campaign to customer. Every layer was built, unit-tested, and proven end to end by
 * `drive-commercial-path`.
 *
 * The drive passes because THE DRIVE sends a session id. The two real forms never did. Nothing in
 * the tree read `_rfp_sid` back, so `/admin/funnel` would have reported "0 of N contacts carry a
 * first-touch session" forever — correctly, and uselessly, on a chain complete at every layer
 * except the three lines that feed it.
 *
 * No lens could see this. The routes answer 201, the columns accept NULL by design, the funnel
 * renders honestly, and the drive is green. It is only visible by asking whether the CLIENT sends
 * the field — which is what this test does.
 *
 * ── WHY A SOURCE SCAN AND NOT A RENDER TEST ──────────────────────────────────────────────────
 * A render test would need jsdom, sessionStorage, a fetch mock and a submit — and would then prove
 * that the mock received the field, which is a fact about the mock. The property that matters is
 * structural: every component that POSTs to a capture route reads the session helper. That is
 * exactly what a scan can answer, and it stays true for the next capture form somebody adds.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** The public capture endpoints. A POST to one of these begins the funnel. */
const CAPTURE_ROUTES = ['/api/applications', '/api/waitlist'];

/** The single place a browser session id may be read from. */
const HELPER = 'visitorSessionId';

function componentFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
  };
  for (const d of ['components', 'app']) {
    try { if (statSync(join(ROOT, d)).isDirectory()) walk(join(ROOT, d)); } catch { /* absent */ }
  }
  return out;
}

const rel = (f: string) => f.replace(ROOT + '/', '');

/** Files that POST to a capture route — the set that must feed the chain. */
function capturePosters(): string[] {
  return componentFiles().filter((f) => {
    const src = readFileSync(f, 'utf8');
    // The route handler itself is not a poster.
    if (rel(f).startsWith('app/api/')) return false;
    return CAPTURE_ROUTES.some((r) => src.includes(`'${r}'`) || src.includes(`"${r}"`));
  });
}

describe('public capture forms feed the attribution chain', () => {
  it('the scan finds the capture forms at all', () => {
    // An empty set passes every assertion below for the wrong reason — this is the whole
    // instrument-before-the-finding rule, and the defect being guarded was itself a silence.
    const posters = capturePosters().map(rel);
    expect(posters.length, 'no component posts to a capture route — the scan root or the route '
      + 'list is wrong').toBeGreaterThan(0);
    expect(posters).toContain('components/marketing/application-form.tsx');
    expect(posters).toContain('components/marketing/waitlist-form.tsx');
  });

  it('every capture poster reads the visitor session', () => {
    const offenders = capturePosters().filter((f) => !readFileSync(f, 'utf8').includes(HELPER));
    expect(
      offenders.map(rel),
      `these components POST to a capture route without sending the visitor session. The columns `
      + `accept NULL by design, so the route answers 201 and nothing fails — but every such `
      + `submission is un-attributable forever, and /admin/funnel can only report that it has `
      + `nothing to measure. Import { ${HELPER} } from '@/lib/visitor-session'.`,
    ).toEqual([]);
  });

  it('the session key has exactly one writer and one reader', () => {
    // Two places spelling the sessionStorage key is the "one value, two places" bug this repo has
    // hit six times. The tracker writes it; lib/visitor-session reads it; nobody else names it.
    const naming = componentFiles()
      .concat([join(ROOT, 'lib', 'visitor-session.ts')])
      .filter((f) => { try { return readFileSync(f, 'utf8').includes('_rfp_sid'); } catch { return false; } })
      .map(rel)
      .sort();
    expect(naming).toEqual(['components/analytics/tracker.tsx', 'lib/visitor-session.ts']);
  });
});
