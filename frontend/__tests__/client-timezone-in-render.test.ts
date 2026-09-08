/**
 * A `'use client'` component must not format a date in the AMBIENT time zone while it renders.
 *
 * ── THE BUG CLASS (B156) ─────────────────────────────────────────────────────────────────────
 * The sibling of `client-clock-in-render.test.ts`. That one guards *WHEN* a value was computed;
 * this one guards *WHERE*. `toLocaleDateString` / `toLocaleTimeString` / a date-shaped
 * `toLocaleString` with no `timeZone` formats in whatever zone the renderer sits in — UTC in the
 * container, the viewer's in the browser. React's own hydration-mismatch list names it outright:
 * *"date formatting in a user's locale which doesn't match the server."*
 *
 * Captured on a dev build, `/admin/sources`, browser pinned to America/New_York:
 *
 *     +  Aug 25, 2026, 04:02 PM        (client)
 *     -  Aug 25, 2026, 08:02 PM        (server)
 *
 * Four hours apart, inside `<SourceCard>`. That is React #418: hydration fails for the WHOLE
 * subtree and the page drops to its error boundary, **while the route answers HTTP 200** — so
 * nothing gating on a status code can see it.
 *
 * ── WHY IT LOOKED LIKE A RARE INTERMITTENT FOR MONTHS ────────────────────────────────────────
 * The sandbox runs the server AND the browser in UTC, so both sides format identically and every
 * sweep is clean. In production it is not intermittent at all: it fires for every admin whose
 * browser is not UTC, which is all of them. **A bug that cannot occur on the machine you test on
 * is not a rare bug.** Seven components carried it; `#418` had been recorded five times against
 * five unrelated routes as "observed, unreproduced".
 *
 * ── WHAT IT MATCHES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────────────────────
 * The dangerous SHAPE: a module-level function in a `'use client'` file that formats a DATE with
 * no `timeZone` and is called from JSX. Not matched, on purpose:
 *   · `Number.prototype.toLocaleString()` for thousands separators — no zone involved.
 *   · a `toLocale*` inside an effect, a handler or a `useMemo` — those do not run in the server
 *     render, so the two sides cannot disagree.
 *   · a call that passes `timeZone` — pinning UTC is the right fix where the value IS UTC (cron
 *     schedules, B92); the mount rule is the right fix where the viewer's own zone is wanted.
 *   · `components/ui/time-ago.tsx` — it IS the fix, and its unguarded branch is unreachable until
 *     mounted. Exempted by name, which is a decision recorded here rather than a silent skip.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING. This repo documents each defect at its own site, so the
 * files that describe this bug quote the very call that causes it — an instrument that reads prose
 * as code reports the most defects exactly where the most care was taken.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const ROOTS = ['app', 'components'];
/** The canonical fix module — its pre-mount branch is the deterministic one. */
const EXEMPT = ['components/ui/time-ago.tsx'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
    return /\.tsx$/.test(e.name) ? [full] : [];
  });
}

/** Block and line comments out, so we ask what a file DOES, not what it is ABOUT. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Module-level function declarations as `{ name, body }`. Brace-matched, not regex-guessed. */
function topLevelFunctions(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /^(?:export\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', re.lastIndex);
    if (open < 0) continue;
    let depth = 0;
    let i = open;
    for (; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1;
      else if (src[i] === '}') { depth -= 1; if (depth === 0) break; }
    }
    out.push({ name: m[1], body: src.slice(open, i + 1) });
  }
  return out;
}

const LOCALE_CALL = /\.toLocale(?:Date|Time)?String\s*\(([\s\S]{0,220}?)\)/g;
/** Options that only make sense for a date — what separates a date format from a number format. */
const DATE_OPTS = /\b(year|month|day|hour|minute|second|weekday|timeZone)\s*:/;

/** True when the body formats a DATE with no `timeZone`. */
function formatsAmbientDate(body: string): boolean {
  let m: RegExpExecArray | null;
  LOCALE_CALL.lastIndex = 0;
  while ((m = LOCALE_CALL.exec(body))) {
    const args = m[1];
    const isDate = /toLocale(Date|Time)String/.test(m[0]) || DATE_OPTS.test(args);
    if (isDate && !/timeZone\s*:/.test(args)) return true;
  }
  return false;
}

const detect = (src: string) => topLevelFunctions(stripComments(src)).some(
  (fn) => formatsAmbientDate(fn.body)
    && new RegExp(`\\{[^{}\\n]*\\b${fn.name}\\(`).test(stripComments(src)));

describe("a 'use client' component does not format a date in the ambient zone during render", () => {
  it('has no module-level date formatter without a timeZone that is called from JSX', () => {
    // THE DETECTOR MUST SEE THE THING IT GUARDS AGAINST, or a clean run below means nothing.
    // These four fixtures are the real classification boundary, not decoration.
    const unsafe = `'use client';\nfunction f(iso){ return new Date(iso).toLocaleDateString('en-US',{hour:'2-digit'}); }\nexport default () => <p>{f(x)}</p>;`;
    const pinned = `'use client';\nfunction f(iso){ return new Date(iso).toLocaleDateString('en-US',{hour:'2-digit',timeZone:'UTC'}); }\nexport default () => <p>{f(x)}</p>;`;
    const numeric = `'use client';\nfunction f(n){ return n.toLocaleString('en-US'); }\nexport default () => <p>{f(x)}</p>;`;
    const commented = `'use client';\n/* it used to call toLocaleDateString('en-US',{hour:'2-digit'}) here */\nfunction f(iso){ return iso; }\nexport default () => <p>{f(x)}</p>;`;
    expect(detect(unsafe), 'must flag an unpinned date format rendered from JSX').toBe(true);
    expect(detect(pinned), 'must leave an explicit timeZone alone').toBe(false);
    expect(detect(numeric), 'must not flag Number.toLocaleString').toBe(false);
    expect(detect(commented), 'must not flag a bug described in a comment').toBe(false);

    const offenders: string[] = [];
    for (const r of ROOTS) {
      const dir = join(ROOT, r);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      for (const file of walk(dir)) {
        const rel = relative(ROOT, file);
        if (EXEMPT.includes(rel)) continue;
        const raw = readFileSync(file, 'utf8');
        if (!/^['"]use client['"]/m.test(raw)) continue;
        const src = stripComments(raw);
        for (const fn of topLevelFunctions(src)) {
          if (!formatsAmbientDate(fn.body)) continue;
          if (new RegExp(`\\{[^{}\\n]*\\b${fn.name}\\(`).test(src)) offenders.push(`${rel} → ${fn.name}()`);
        }
      }
    }

    expect(
      offenders,
      'use <LocalTime iso={x} opts={…}/> or localFrom(x, mounted) from components/ui/time-ago, '
        + 'or pass an explicit timeZone when the value really is defined in one',
    ).toEqual([]);
  });
});
