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

  /**
   * ── THE SHAPE THE TEST ABOVE CANNOT SEE (B160) ──────────────────────────────────────────────
   *
   * The guard above matches a module-level helper whose body builds an "ago"-shaped string. That is
   * the shape of the eight occurrences it was written for, and SEVEN more were found that it had no
   * chance of catching, because they read the clock somewhere else entirely:
   *
   *   · `const now = Date.now()` in a component body, feeding a filter, a count or an inline style
   *   · a bare `Date.now()` inline in JSX, deciding whether a badge element exists at all
   *   · a helper computing a DAY COUNT or a boolean, with no "ago" anywhere in it
   *
   * The last is the important one. `isStale()` returning a boolean that gates an element is a
   * DOM-STRUCTURE mismatch — a node present on one side and absent on the other — which is strictly
   * worse than two different strings, and nothing about its text says "time".
   *
   * ── WHY THIS NEEDS AN EXEMPTION TABLE, AND WHY THAT IS HONEST ───────────────────────────────
   * Whether a clock read is dangerous depends on whether its value reaches the SERVER render, and
   * that is a data-flow question a text scan cannot answer. A component that fetches its rows in an
   * effect renders an empty list on the server, so its clock read is unreachable there and safe.
   * Five of the twelve candidates measured were exactly that, and "fixing" them would have been
   * change with no defect behind it.
   *
   * So the reachable ones are ENUMERATED with the reason each is safe, rather than the scan being
   * narrowed until it reports nothing. An unexplained exclusion is how a real occurrence leaves the
   * list; a stated one can be checked by reading the file.
   */
  const SAFE_BECAUSE: Array<[string, string]> = [
    ['components/portal/automation-overview-card.tsx', 'renders a loading div until an effect fetches `data` — the list never server-renders'],
    ['components/portal/pipeline-cards.tsx', '`cards` starts [] and is fetched in an effect, so the day-count filter runs over nothing on the server'],
    ['components/portal/purchase-modal.tsx', 'mounted only when a card is clicked — never present in the server render'],
    ['components/tasks/task-queue.tsx', '`tasks` starts null and is fetched in an effect; the sort and every child run only after mount'],
    ['components/analytics/tracker.tsx', 'the ref value is never rendered — it measures dwell time and is read by the beacon'],
    ['app/portal/[tenantSlug]/portals/[portalId]/workflow-setup-client.tsx', 'inside an onClick — generates a key for a newly added stage'],
    ['components/canvas/canvas-editor.tsx', 'stamps provenance on an edit action, inside handlers'],
    ['components/canvas/draft-all-sections.tsx', 'timestamps a draft request inside an async submit'],
    ['components/projects/cdrl-register.tsx', 'seeds a date input from an onClick'],
    ['components/projects/modification-log.tsx', 'seeds a date input from an onClick'],
    ['components/proposal/section-assist-bar.tsx', 'timestamps an assist request inside a handler'],
    ['components/rfp-curation/triage-queue.tsx', 'the remaining read stamps claimedAt inside the claim handler; the two render-path reads are fixed'],
  ];
  const EXEMPT_FILES = new Set(SAFE_BECAUSE.map(([f]) => f));

  it('has no clock read on a render path outside the enumerated exemptions', () => {
    // Blank comments and the bodies of hooks, PRESERVING NEWLINES — collapsing them shifts every
    // following line number, which reads as a scan that found nothing rather than one that lost
    // its place. That was a real bug in the first version of this sweep.
    const blankKeepingLines = (src: string) => src
      .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (c, p1) => p1 + ' '.repeat(c.length - p1.length));

    function blankHookBodies(src: string): string {
      let out = src;
      for (const kw of ['useEffect', 'useCallback', 'useMemo']) {
        let i = 0;
        for (;;) {
          const at = out.indexOf(`${kw}(`, i);
          if (at < 0) break;
          const open = out.indexOf('{', at);
          if (open < 0) { i = at + kw.length; continue; }
          let d = 0;
          let j = open;
          for (; j < out.length; j += 1) {
            if (out[j] === '{') d += 1;
            else if (out[j] === '}') { d -= 1; if (d === 0) break; }
          }
          if (j >= out.length) { i = at + kw.length; continue; }
          out = out.slice(0, open) + out.slice(open, j + 1).replace(/[^\n]/g, ' ') + out.slice(j + 1);
          i = j + 1;
        }
      }
      return out;
    }

    const CLOCK = /\bDate\.now\s*\(\s*\)|\bnew Date\s*\(\s*\)/;
    const reachable = (src: string) => CLOCK.test(blankHookBodies(blankKeepingLines(src)));

    // The detector must see the shapes it exists for, and leave the safe ones alone.
    expect(reachable(`'use client';\nexport default function C(){ const now = Date.now(); return <p>{now}</p>; }`),
      'must flag a clock read in a component body').toBe(true);
    expect(reachable(`'use client';\nexport default () => <p>{Date.now() > x ? 'a' : 'b'}</p>;`),
      'must flag a bare clock read inline in JSX').toBe(true);
    expect(reachable(`'use client';\nexport default function C(){ useEffect(() => { const n = Date.now(); }, []); return <p/>; }`),
      'must not flag a useEffect body').toBe(false);

    const offenders: string[] = [];
    for (const r of ROOTS) {
      const dir = join(ROOT, r);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      for (const file of walk(dir)) {
        const rel = relative(ROOT, file);
        if (rel === 'components/ui/time-ago.tsx' || EXEMPT_FILES.has(rel)) continue;
        const raw = readFileSync(file, 'utf8');
        if (!/^['"]use client['"]/m.test(raw)) continue;
        if (reachable(raw)) offenders.push(rel);
      }
    }

    expect(
      offenders,
      'a clock read reachable from render makes the output a function of WHEN it rendered. Thread '
        + '`useClientNow()` (null until mounted) — or, if the value cannot reach the server render, '
        + 'add the file to SAFE_BECAUSE above WITH the reason',
    ).toEqual([]);
  });

  it('every exemption still names a file that exists and still reads the clock', () => {
    // AN EXEMPTION THAT NO LONGER APPLIES IS HOW A REAL OCCURRENCE GETS WAVED THROUGH. If a file is
    // renamed, or its clock read is removed, the entry must go — otherwise the list quietly grows
    // into a blanket. This is the drift that turned EXTERNAL_CALLER into a table naming two of four.
    const stale: string[] = [];
    for (const [rel, why] of SAFE_BECAUSE) {
      let raw: string;
      try { raw = readFileSync(join(ROOT, rel), 'utf8'); } catch { stale.push(`${rel} — no such file`); continue; }
      if (!/\bDate\.now\s*\(\s*\)|\bnew Date\s*\(\s*\)/.test(raw)) stale.push(`${rel} — no clock read left, drop the exemption`);
      if (!why.trim()) stale.push(`${rel} — exemption carries no reason`);
    }
    expect(stale, 'prune SAFE_BECAUSE').toEqual([]);
  });
});
