/**
 * THE STATE MACHINE THE LOOP RUNS ON, AND THE ONE TRANSITION NOBODY WOULD NOTICE.
 *
 * `open` and `ready` are self-evident from the guide's own text. `stale` is the one that matters
 * and the one that cannot be observed by reading anything: it means the SURFACE moved after the
 * prose describing it, and the only person who would notice is the one who happens to open both.
 * That is the "new features, spin it up again" signal, and if it depends on anyone remembering, it
 * does not exist.
 *
 * So it is derived from git — and the derivation has exactly one subtle trap, which this pins: the
 * guide lives INSIDE the surface's own directory, so a naive "last commit touching this folder"
 * marks a guide fresh the moment you edit the guide. `catalog-guides.mjs` excludes `*-guide.tsx`
 * from the surface's timestamp for that reason, and the test below fails if that exclusion is ever
 * dropped.
 *
 * The second half asserts the LIVE override: a guide with nothing unwritten but unresolved notes
 * against it is not ready. Somebody used it, said it was wrong, and nobody answered — that is the
 * state the board exists to make visible.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { effectiveState, type CoverageRow } from '@/lib/guides/coverage';

const REPO = '/home/user/govwin';
const row = (over: Partial<CoverageRow>): CoverageRow => ({
  route: '/admin/x', dir: 'app/admin/x', guide: 'app/admin/x/x-guide.tsx',
  state: 'ready', steps: [], controls: [], unwritten: 0, canon: null,
  surfaceChangedAt: 100, guideWrittenAt: 200, ...over,
});

describe('the derived state, and the transition nobody would notice', () => {
  it('a guide with unwritten sections is open, notes or not', () => {
    expect(effectiveState(row({ state: 'open', unwritten: 2 }), {})).toBe('open');
    expect(effectiveState(row({ state: 'open', unwritten: 2 }), { '/admin/x': 3 })).toBe('open');
  });

  it('a finished guide with an unanswered note is NOT ready', () => {
    expect(effectiveState(row({ state: 'ready' }), {})).toBe('ready');
    expect(effectiveState(row({ state: 'ready' }), { '/admin/x': 1 })).toBe('open');
  });

  it('stale outranks everything — a moved surface is not made fresh by answering notes', () => {
    expect(effectiveState(row({ state: 'stale' }), {})).toBe('stale');
    expect(effectiveState(row({ state: 'stale' }), { '/admin/x': 5 })).toBe('stale');
  });

  it('a surface with no guide stays none, whatever else is true', () => {
    expect(effectiveState(row({ state: 'none', guide: null }), { '/admin/x': 9 })).toBe('none');
  });

  it('counts by exact route, not prefix — /admin/sources must not absorb a sibling', () => {
    // Counting notes by prefix would fold `/admin/sources-archive` into `/admin/sources` the day
    // such a route exists. The join is on the exact route for that reason.
    expect(effectiveState(row({ route: '/admin/sources' }), { '/admin/sources-archive': 4 })).toBe('ready');
  });
});

describe('the git derivation the catalog depends on', () => {
  const at = (...args: string[]) => {
    try {
      return Number(execFileSync('git', ['log', '-1', '--format=%ct', '--', ...args], { cwd: REPO, encoding: 'utf8' }).trim()) || 0;
    } catch { return 0; }
  };

  it('git answers for a tracked surface at all — a 0 would make every guide look fresh', () => {
    expect(at('frontend/app/admin/scouts')).toBeGreaterThan(0);
  });

  it('EXCLUDES the guide from the surface timestamp — the trap that would hide every stale row', () => {
    const dir = 'frontend/app/admin/scouts';
    const withGuide = at(dir);
    const withoutGuide = at(dir, `:(exclude)${dir}/*-guide.tsx`);
    expect(withoutGuide).toBeGreaterThan(0);
    // Editing only the guide must not move the surface's clock. They may be equal when both landed
    // in one commit; what must never happen is the surface reading NEWER because of a guide edit.
    expect(withoutGuide).toBeLessThanOrEqual(withGuide);
  });

  it('the catalog script actually applies that exclusion', () => {
    const src = readFileSync(join(REPO, 'frontend/scripts/catalog-guides.mjs'), 'utf8');
    expect(src).toMatch(/:\(exclude\)\$\{s\.dir\}\/\*-guide\.tsx/);
  });
});

describe('the coverage artifact is real, and says what it covers', () => {
  const P = join(REPO, 'docs/guide-coverage.json');

  it('exists — the board reports its absence rather than rendering an empty table', () => {
    expect(existsSync(P)).toBe(true);
  });

  it('counts every admin surface, not only the ones with a guide', () => {
    const art = JSON.parse(readFileSync(P, 'utf8')) as {
      summary: { surfaces: number; none: number }; rows: Array<{ route: string; state: string }>;
    };
    expect(art.rows.length).toBe(art.summary.surfaces);
    // The whole point: unguided surfaces are IN the denominator. A registry of guides would show
    // four green rows and no idea what is missing.
    expect(art.summary.none).toBeGreaterThan(0);
    expect(art.rows.some((r) => r.state === 'none')).toBe(true);
  });
});
