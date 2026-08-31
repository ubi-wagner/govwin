/**
 * A client component must not format with the AMBIENT locale or timezone.
 *
 * ── THE CLOCK BUG'S SIBLING, AND THE NINTH OCCURRENCE OF THE FAMILY ──────────────────────────
 * `__tests__/client-clock-in-render.test.ts` guards `Date.now()` during render. This guards the
 * other way to get the same failure:
 *
 *     new Date(iso).toLocaleString(undefined, { … })     ← two ambients, not one
 *     amount.toLocaleString()                            ← "250,000" vs "250.000"
 *
 * `undefined` (or an omitted first argument) means "use the ambient locale". The server has Node's
 * locale and the container's timezone; the browser has the visitor's. When they differ the strings
 * differ, React throws #418, and hydration fails for the WHOLE SUBTREE while the route answers
 * HTTP 200 — so nothing gating on a status code can see it. That is not theory: the atlas sweep
 * caught `/admin/analytics` doing exactly this and going to its error boundary.
 *
 * The clock guard could not see it, because there is no clock read. A guard narrower than its
 * defect is a guard that gets trusted wrongly — the same lesson the backtick check learned when
 * its sixth instance landed in a file extension it did not walk.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────────────────────
 * `'use client'` files only. A server component renders once, so there is nothing to mismatch — and
 * its output is generated in one place by definition. Use `lib/fmt.ts` at every flagged site, or
 * render after mount (`useClientNow`) where a genuine local time is wanted.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const ROOTS = ['app', 'components'];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

/** `.toLocaleX(` with the first argument omitted or literally `undefined`. */
const IMPLICIT = /\.toLocale(?:String|DateString|TimeString)\s*\(\s*(?:\)|undefined\b)/;

/** lib/fmt.ts is the ONE place a locale is named, and it names it explicitly. */
const EXEMPT = new Set(['lib/fmt.ts']);

describe('a client component formats with a PINNED locale and timezone', () => {
  it('holds across app and components', () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap((r) => { try { return walk(join(ROOT, r)); } catch { return []; } })) {
      const rel = relative(ROOT, file);
      if (EXEMPT.has(rel)) continue;
      const src = readFileSync(file, 'utf8');
      // Only client components: a server component renders once, in one place.
      if (!/^\s*['"]use client['"]/m.test(src.split('\n').slice(0, 3).join('\n'))) continue;
      src.split('\n').forEach((line, i) => {
        if (IMPLICIT.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 96)}`);
      });
    }
    expect(offenders,
      'Ambient-locale formatting in a client component. The server and the browser have DIFFERENT\n' +
      'ambients, so these render differently, React throws #418, and the page dies at HTTP 200.\n' +
      'Use lib/fmt.ts (fmtDate · fmtDateTime · fmtShortDateTime · fmtNum · fmtMoney), or render\n' +
      'after mount with useClientNow where a genuine LOCAL time is wanted:\n\n' +
      `${offenders.join('\n')}\n`).toEqual([]);
  });
});
