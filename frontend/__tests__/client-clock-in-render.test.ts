/**
 * A `'use client'` component must not read the clock while it renders.
 *
 * ── THE BUG CLASS, NOW AT ITS EIGHTH OCCURRENCE ──────────────────────────────────────────────
 * A client component that calls `Date.now()` during render makes its output a function of WHEN it
 * rendered. The server writes "just now"; the client hydrates a beat later and computes "1m ago";
 * the text does not match and React throws **#418**. That does not degrade one cell — hydration
 * fails for the whole subtree and the page drops to its error boundary, **while the route answers
 * HTTP 200 the entire time.** Nothing gating on a status code can see it (bug log B79).
 *
 * It is also INTERMITTENT, which is why it keeps coming back: server and client usually agree, and
 * disagree only when the gap between them crosses a rounding boundary. Under a fast local run
 * everything is green; under a 153-page sweep the atlas caught two pages mid-throw, on two
 * different routes, and neither reproduced afterwards.
 *
 * `components/ui/time-ago.tsx` is the fix: `now` is null until mounted, so the first paint is a
 * deterministic UTC stamp on both sides and the relative form appears on the next tick. This test
 * is what stops the next component from re-implementing the unsafe version — five of them had.
 *
 * ── WHAT IT MATCHES, AND WHAT IT DELIBERATELY DOES NOT ───────────────────────────────────────
 * The dangerous SHAPE, not every clock read: a module-level function in a `'use client'` file that
 * (a) reads the clock, (b) builds a relative-time string, and (c) is called from JSX. A clock read
 * inside an effect, a handler or a `useMemo` is fine and is not matched — those do not run during
 * the server render.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const ROOTS = ['app', 'components'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(full);
    return /\.tsx$/.test(e.name) ? [full] : [];
  });
}

/** Function declarations at module level, as `{ name, body }`. Brace-matched, not regex-guessed. */
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

const READS_CLOCK = /\bDate\.now\(\)|\bnew Date\(\s*\)/;
const RELATIVE_STRING = /ago|just now/i;

describe("a 'use client' component does not read the clock during render", () => {
  it('has no module-level relative-time helper that reads the clock and is called from JSX', () => {
    const offenders: string[] = [];

    for (const r of ROOTS) {
      const dir = join(ROOT, r);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      for (const file of walk(dir)) {
        const src = readFileSync(file, 'utf8');
        if (!/^['"]use client['"]/m.test(src)) continue;
        for (const fn of topLevelFunctions(src)) {
          if (!READS_CLOCK.test(fn.body)) continue;
          if (!RELATIVE_STRING.test(fn.body)) continue;
          // Called from JSX — `{name(` or `{cond ? name(`, i.e. its value is rendered.
          const calledInJsx = new RegExp(`\\{[^{}\\n]*\\b${fn.name}\\(`).test(src);
          if (calledInJsx) offenders.push(`${relative(ROOT, file)} → ${fn.name}()`);
        }
      }
    }

    // The guard has to be able to see the thing it guards against, or a clean run means nothing.
    const bad = `'use client';\nfunction rel(iso){ const s=(Date.now()-+new Date(iso))/1000; return \`\${s}s ago\`; }\nexport default () => <p>{rel(x)}</p>;`;
    const safe = `'use client';\nfunction rel(iso, now){ if(now===null) return iso; return \`\${now}s ago\`; }\nexport default () => <p>{rel(x, useClientNow())}</p>;`;
    const detect = (src: string) => topLevelFunctions(src).some((fn) => READS_CLOCK.test(fn.body)
      && RELATIVE_STRING.test(fn.body) && new RegExp(`\\{[^{}\\n]*\\b${fn.name}\\(`).test(src));
    expect(detect(bad), 'the detector must see an unsafe helper').toBe(true);
    expect(detect(safe), 'the detector must leave a now-parameterised helper alone').toBe(false);

    expect(offenders, 'use <TimeAgo iso={x}/> or relativeFrom(x, useClientNow()) from components/ui/time-ago')
      .toEqual([]);
  });
});
