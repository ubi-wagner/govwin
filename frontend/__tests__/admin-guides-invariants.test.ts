/**
 * THE DISCOVERY GUIDES MAY NOT QUIETLY BECOME A FEATURE TOUR.
 *
 * Sources → scouts → intake is the arc where the *irreversible* decisions live, and it is the one
 * a first-time curator meets in week one. Three things on that path cannot be taken back, and a
 * guide that describes the buttons while omitting them is worse than no guide, because it is read
 * as a complete account:
 *
 *   · releasing a scout finding is ONE-WAY, and new-vs-update is the expensive call
 *   · a solicitation staged twice becomes two records that customers then split between
 *   · a guessed field becomes a value a customer reads as read-from-the-source
 *
 * This test pins those, plus two structural properties that keep the guides honest over time:
 * every guide must be MOUNTED (an unrendered guide documents nothing — the exact defect that put
 * the companion's manual in a path an admin cannot open), and every guide must POINT AT its
 * canonical doc rather than fork it, because two copies of the same prose drift within a fortnight.
 *
 * It deliberately does NOT assert wording beyond those claims. The guides are meant to be rewritten
 * from what real curation teaches — that is the whole point of the note box — and a test that pins
 * prose would make the rewriting expensive.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const GUIDES = [
  { name: 'sources', guide: 'app/admin/sources/sources-guide.tsx', page: 'app/admin/sources/page.tsx', comp: 'SourcesGuide', canon: 'SCOUT_INTAKE_QUEUE' },
  { name: 'scouts', guide: 'app/admin/scouts/scouts-guide.tsx', page: 'app/admin/scouts/page.tsx', comp: 'ScoutsGuide', canon: 'SCOUT_INTAKE_QUEUE' },
  { name: 'intake', guide: 'app/admin/intake/intake-guide.tsx', page: 'app/admin/intake/page.tsx', comp: 'IntakeGuide', canon: 'INGEST_PROVENANCE' },
];

describe('the discovery guides are mounted, anchored, and correctable', () => {
  for (const g of GUIDES) {
    it(`${g.name}: exists and is actually rendered on its page`, () => {
      expect(existsSync(join(ROOT, g.guide)), g.guide).toBe(true);
      const page = read(g.page);
      expect(page).toMatch(new RegExp(`<${g.comp}\\s*/>`));
    });

    it(`${g.name}: points at its canonical doc instead of forking it`, () => {
      expect(read(g.guide)).toContain(g.canon);
    });

    it(`${g.name}: every step can be corrected by the person reading it`, () => {
      const src = read(g.guide);
      const steps = (src.match(/<Step\s/g) ?? []).length;
      expect(steps, 'a guide with no steps has nothing to note against').toBeGreaterThan(2);
      // `Step` renders the note box itself, so the affordance cannot be forgotten per-step — this
      // asserts the guide uses `Step` rather than hand-rolling sections that would skip it.
      expect(src).toMatch(/from '@\/components\/admin\/guide'/);
    });
  }

  it('the note box writes to the shared board, attributed server-side', () => {
    const box = read('components/admin/guide-note.tsx');
    expect(box).toContain('/api/admin/notes');
    // The whole value of the board is that you can trust who said what. A client-supplied author
    // would destroy that, so the box must not send one.
    expect(box).not.toMatch(/author:\s*['"]/);
    expect(box).toMatch(/disposition/);
  });

  it('the notes route whitelists the disposition rather than storing what it is sent', () => {
    const route = read('app/api/admin/notes/route.ts');
    expect(route).toMatch(/DISPOSITIONS/);
    expect(route).toMatch(/'gap'.*'defect'.*'friction'/s);
    expect(route).toMatch(/author: 'human'/);
  });
});

describe('the three things a first-time curator can be harmed by not knowing', () => {
  it('scouts: release is one-way, and new-vs-update is the expensive call', () => {
    const g = read('app/admin/scouts/scouts-guide.tsx');
    expect(g).toMatch(/one-way|compare-and-swap/i);
    expect(g).toMatch(/releasing an amendment as new|forks a solicitation/i);
  });

  it('scouts: candidate text is data, never an instruction', () => {
    const g = read('app/admin/scouts/scouts-guide.tsx');
    expect(g).toMatch(/never interpreted|never followed as/i);
  });

  it('intake: a duplicate record splits the customers watching it', () => {
    const g = read('app/admin/intake/intake-guide.tsx');
    expect(g).toMatch(/second record|two records/i);
  });

  it('intake: blank beats plausible — a guess becomes a value read as sourced', () => {
    const g = read('app/admin/intake/intake-guide.tsx');
    expect(g).toMatch(/blank beats plausible/i);
    expect(g).toMatch(/Default — unverified/);
  });

  it('the guides admit what they cannot say yet, visibly', () => {
    // Uncovered is not passing — in documentation too. A guide with no `Unwritten` after a first
    // curation week is either finished or dishonest, and it is much more likely to be the second.
    const anyUnwritten = GUIDES.some((g) => read(g.guide).includes('<Unwritten>'));
    expect(anyUnwritten).toBe(true);
  });
});
