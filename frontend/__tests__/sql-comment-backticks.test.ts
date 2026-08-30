/**
 * A backtick inside a SQL comment TERMINATES the tagged template it lives in.
 *
 * ── WHY THIS IS A TEST AND NOT A NOTE IN THE BUG LOG ─────────────────────────────────────────
 * It is already written down — docs/BUG_LOG_2026-08-19.md records a drive crashing with
 * `SyntaxError: Unexpected identifier` from exactly this, and the comment that caused it was
 * amended in place to say so. That did not stop it happening twice more in a single session, in
 * `app/api/portal/[tenantSlug]/cards/route.ts` and `lib/tools/solicitation-push.ts`, both times
 * while writing a comment ABOUT the code — which is when a habit of quoting identifiers in
 * backticks is hardest to suppress.
 *
 * The failure is also badly misleading: TypeScript reports it at the line where the resumed string
 * happens to break the grammar, which can be many lines below the backtick, and the message
 * ("Module declaration names may only use ' or \" quoted strings") names nothing to do with SQL.
 * A guard that points at the offending line costs nothing and ends the class.
 *
 * ── SCOPE, AND WHAT THIS DELIBERATELY DOES NOT COVER ─────────────────────────────────────────
 * It walks .ts/.tsx/.mts/.mjs/.js — widened after the SIXTH instance landed in a .mjs harness the
 * first version did not read.
 *
 * It matches `--` comment lines only. In this tree those appear exclusively inside tagged template
 * literals, which makes the rule EXACT: no context inference, no false positives, no judgement.
 *
 * The SEVENTH instance was a JS block comment (`*`) inside a template, which this cannot see, and
 * the attempt to see it is why the limit is written down rather than papered over. Tracking
 * template depth by counting backticks fails on the first JSDoc that quotes an identifier — an odd
 * count flips the tracker and every line after it is reported. That version named eight offenders,
 * all of them ordinary prose in files containing no SQL. A noisy check is worse than a narrow one:
 * a narrow check is trusted for what it covers, and a noisy one is turned off.
 *
 * Doing it properly needs the TypeScript compiler API to locate template literals exactly — the
 * approach inventory-frontend.mjs already uses. Worth it if an eighth appears; not before.
 * `tsc` catches every one of these immediately regardless. What the guard adds is the LINE, since
 * TypeScript reports the failure wherever the resumed string next breaks the grammar, under a
 * message about module declarations.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['app', 'lib', 'components', 'scripts', 'e2e'];
const SKIP = new Set(['node_modules', '.next', 'dist', 'coverage', '__tests__']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    // ⚠️ .mjs and .mts BOTH, and .py: the first version walked only .ts/.tsx/.mts, and the sixth
    // occurrence of this bug landed in a .mjs harness — the guard written to end the class could
    // not see it. A check with a narrower scope than the defect is a check that will be trusted
    // wrongly.
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

describe('a SQL comment must not contain a backtick', () => {
  it('holds across app, lib, components and scripts', () => {
    const offenders: string[] = [];
    for (const file of ROOTS.flatMap((r) => { try { return walk(r); } catch { return []; } })) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        // A line whose first non-space characters are `--` is a SQL comment; in this tree those
        // occur only inside tagged template literals. A backtick on such a line ends the template.
        // A line whose first non-space characters are `--` is a SQL comment; in this tree those
        // occur only inside tagged template literals, which makes this rule EXACT — no context
        // inference, no false positives.
        if (/^\s*--/.test(line) && line.includes('`')) offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`);
      });
    }
    expect(offenders, `Backtick inside a SQL comment — it ENDS the tagged template.\n` +
      `Drop the backticks; the identifier reads fine without them:\n\n${offenders.join('\n')}\n`)
      .toEqual([]);
  });
});
