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

const LOCALE_CALL = /(\.toLocale(?:Date|Time)?String|Intl\.DateTimeFormat)\s*\(/g;
/** Options that only make sense for a date — what separates a date format from a number format. */
const DATE_OPTS = /\b(year|month|day|hour|minute|second|weekday|timeZone|dateStyle|timeStyle)\s*:/;

/**
 * The argument list, PAREN-MATCHED — never a fixed-width window.
 *
 * The first version captured `([\s\S]{0,220}?)` after the open paren. That is a scanner that
 * silently drops what it cannot parse, and it did: `components/portal/notification-panel.tsx`
 * writes a four-key options object at 26 columns of indentation, whose argument list runs past 220
 * characters, so the regex simply failed to match and the site VANISHED from the count while the
 * guard reported a clean run. It was found only because a WIDER window in a second instrument
 * happened to reach it — i.e. by luck, on a defect that had shipped.
 *
 * Returns null when the parens do not balance, and the caller treats that as UNCHECKED rather than
 * as safe.
 */
function callArgs(src: string, openParen: number): string | null {
  let depth = 0;
  for (let i = openParen; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(') depth += 1;
    else if (c === ')') { depth -= 1; if (depth === 0) return src.slice(openParen + 1, i); }
  }
  return null;
}

/** Sites whose argument list could not be resolved — reported, never counted as clean. */
export const unchecked: string[] = [];

/** True when the source formats a DATE with no `timeZone`. */
function formatsAmbientDate(body: string, label = '<fixture>'): boolean {
  let m: RegExpExecArray | null;
  LOCALE_CALL.lastIndex = 0;
  while ((m = LOCALE_CALL.exec(body))) {
    const open = m.index + m[0].length - 1;
    const args = callArgs(body, open);
    if (args === null) { unchecked.push(`${label} @${m.index} (unbalanced parens)`); continue; }
    const isDate = /toLocale(Date|Time)String|Intl\.DateTimeFormat/.test(m[1]) || DATE_OPTS.test(args);
    if (isDate && !/timeZone\s*:/.test(args)) return true;
  }
  return false;
}

/**
 * ── THE SECOND SWEEP, AND WHY IT WAS NEEDED (B156, part two) ────────────────────────────────
 *
 * The first version of this guard matched module-level `function name() {}` declarations that were
 * then called from JSX. That is the shape the first seven happened to have, and generalising from
 * the cases you already found is exactly how a class survives its own fix: a follow-up sweep found
 * **six more**, every one of them invisible here — four written INLINE IN JSX
 * (`{new Date(x).toLocaleDateString(…)}`, no named function at all) and two assigned from a
 * `const` inside the component body. Two of the six included hour/minute, so they fired on every
 * load for any non-UTC viewer, and one was the canvas version-history panel.
 *
 * So the detector now asks the question directly — **does a `'use client'` file format a date in
 * the ambient zone anywhere that render can reach** — instead of asking whether it does so through
 * one particular syntax. Effects, handlers and `useMemo` bodies are still excluded: those do not
 * run during the server render, so the two sides cannot disagree.
 */

/** Bodies of `useEffect`/`useCallback`/`useMemo` and event handlers — brace-matched, then removed. */
function stripNonRenderBodies(src: string): string {
  let out = src;
  for (const kw of ['useEffect', 'useCallback', 'useMemo']) {
    let i = 0;
    for (;;) {
      const at = out.indexOf(`${kw}(`, i);
      if (at < 0) break;
      const open = out.indexOf('{', at);
      if (open < 0) { i = at + kw.length; continue; }
      let depth = 0;
      let j = open;
      for (; j < out.length; j += 1) {
        if (out[j] === '{') depth += 1;
        else if (out[j] === '}') { depth -= 1; if (depth === 0) break; }
      }
      if (j >= out.length) { i = at + kw.length; continue; }
      out = out.slice(0, open) + '{/*non-render*/}' + out.slice(j + 1);
      i = open + 18;
    }
  }
  return out;
}

const detect = (src: string, label = '<fixture>') =>
  formatsAmbientDate(stripNonRenderBodies(stripComments(src)), label);

describe("a 'use client' component does not format a date in the ambient zone during render", () => {
  it('formats no date in the ambient zone on any render path', () => {
    // THE DETECTOR MUST SEE THE THING IT GUARDS AGAINST, or a clean run below means nothing.
    // Every fixture is a real classification boundary this sweep got wrong at least once.
    const unsafe = `'use client';\nfunction f(iso){ return new Date(iso).toLocaleDateString('en-US',{hour:'2-digit'}); }\nexport default () => <p>{f(x)}</p>;`;
    // The four shapes the FIRST version of this guard missed — all found live (B156 part two).
    const inlineJsx = `'use client';\nexport default () => <p>{new Date(x).toLocaleDateString('en-US',{month:'short'})}</p>;`;
    const arrowConst = `'use client';\nconst f = (iso) => new Date(iso).toLocaleDateString('en-US',{day:'numeric'});\nexport default () => <p>{f(x)}</p>;`;
    const inComponent = `'use client';\nexport default function C(){ const s = new Date(x).toLocaleDateString('en-US',{year:'numeric'}); return <p>{s}</p>; }`;
    const intl = `'use client';\nexport default () => <p>{new Intl.DateTimeFormat('en-US',{month:'short'}).format(d)}</p>;`;
    // …and the four that must stay quiet.
    const pinned = `'use client';\nfunction f(iso){ return new Date(iso).toLocaleDateString('en-US',{hour:'2-digit',timeZone:'UTC'}); }\nexport default () => <p>{f(x)}</p>;`;
    const numeric = `'use client';\nfunction f(n){ return n.toLocaleString('en-US'); }\nexport default () => <p>{f(x)}</p>;`;
    const currency = `'use client';\nfunction f(n){ return n.toLocaleString('en-US',{style:'currency',currency:'USD'}); }\nexport default () => <p>{f(x)}</p>;`;
    const commented = `'use client';\n/* it used to call toLocaleDateString('en-US',{hour:'2-digit'}) here */\nfunction f(iso){ return iso; }\nexport default () => <p>{f(x)}</p>;`;
    const inEffect = `'use client';\nexport default function C(){ useEffect(() => { log(new Date(x).toLocaleDateString('en-US',{day:'numeric'})); }, []); return <p/>; }`;

    expect(detect(unsafe), 'must flag an unpinned date format rendered from JSX').toBe(true);
    expect(detect(inlineJsx), 'must flag an INLINE toLocale* in JSX — 4 live cases hid here').toBe(true);
    expect(detect(arrowConst), 'must flag an arrow const, not just a function declaration').toBe(true);
    expect(detect(inComponent), 'must flag a helper inside the component body — 2 live cases').toBe(true);
    expect(detect(intl), 'must flag Intl.DateTimeFormat with no timeZone').toBe(true);
    expect(detect(pinned), 'must leave an explicit timeZone alone').toBe(false);
    expect(detect(numeric), 'must not flag Number.toLocaleString').toBe(false);
    expect(detect(currency), 'must not flag currency formatting — 3 live false positives').toBe(false);
    expect(detect(commented), 'must not flag a bug described in a comment').toBe(false);
    expect(detect(inEffect), 'must not flag a useEffect body — it never server-renders').toBe(false);

    const offenders: string[] = [];
    for (const r of ROOTS) {
      const dir = join(ROOT, r);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      for (const file of walk(dir)) {
        const rel = relative(ROOT, file);
        if (EXEMPT.includes(rel)) continue;
        const raw = readFileSync(file, 'utf8');
        if (!/^['"]use client['"]/m.test(raw)) continue;
        if (detect(raw, rel)) offenders.push(rel);
      }
    }

    expect(
      offenders,
      'use <LocalTime iso={x} opts={…}/> or localFrom(x, mounted) from components/ui/time-ago, '
        + 'or pass an explicit timeZone when the value really is defined in one',
    ).toEqual([]);

    // A SITE THE SCANNER COULD NOT RESOLVE IS NOT A CLEAN SITE. The previous version of this guard
    // used a fixed-width argument window and silently dropped a real defect whose options object
    // ran past it — reporting a clean sweep. Anything unparseable now fails the test by name.
    expect(unchecked, 'unresolvable toLocale*/Intl.DateTimeFormat call sites — widen the parser, '
      + 'do not ignore them').toEqual([]);
  });
});
