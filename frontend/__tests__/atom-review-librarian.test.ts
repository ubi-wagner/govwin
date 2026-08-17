/**
 * Librarian catalog parsing (#5, the librarian half) — lib/atom-review.ts.
 *
 * The librarian emits a per-atom `vol`, `kind`, and `suggested_tags: ["dimension:value"]`.
 * The parser used to drop all three; these tests pin that it now captures + normalizes them
 * (so a `retag` recommendation becomes applicable), and that malformed tag entries are dropped.
 */
import { describe, expect, it } from 'vitest';
import { parseLibrarianCatalog } from '@/lib/atom-review';

const A1 = '00000000-0000-0000-0000-0000000000a1';
const A2 = '00000000-0000-0000-0000-0000000000a2';
const validAtoms = new Map<string, string | null>([[A1, 'Technical Approach'], [A2, 'Bio — PI']]);

function catalog(assessments: unknown[]): string {
  return JSON.stringify({ assessments });
}

describe('parseLibrarianCatalog — vol/kind/suggested_tags capture', () => {
  it('captures and slugifies vol/kind and parses suggested_tags into {dimension,value}', () => {
    const raw = catalog([
      {
        atom_id: A1,
        vol: 'Past Performance',
        kind: 'Past Perf Blurb',
        suggested_tags: ['agency:navy', 'program:sttr', 'phase:phase_1'],
        recommendation: { action: 'retag', reason: 'vol is wrong' },
      },
    ]);
    const layer = parseLibrarianCatalog(raw, validAtoms, '2026-08-17T00:00:00Z');
    expect(layer).not.toBeNull();
    const a = layer!.assessments[0];
    expect(a.atomId).toBe(A1);
    expect(a.vol).toBe('past_performance'); // slugified
    expect(a.kind).toBe('past_perf_blurb'); // slugified
    expect(a.action).toBe('retag');
    expect(a.suggestedTags).toEqual([
      { dimension: 'agency', value: 'navy' },
      { dimension: 'program', value: 'sttr' },
      { dimension: 'phase', value: 'phase_1' },
    ]);
  });

  it('drops malformed suggested_tags (no colon / empty side) and dedupes', () => {
    const raw = catalog([
      {
        atom_id: A2,
        suggested_tags: ['nocolon', ':novalue', 'nodim:', 'agency:navy', 'agency:navy', 'kind:bio'],
      },
    ]);
    const layer = parseLibrarianCatalog(raw, validAtoms, 'x');
    const a = layer!.assessments[0];
    expect(a.suggestedTags).toEqual([
      { dimension: 'agency', value: 'navy' },
      { dimension: 'kind', value: 'bio' },
    ]);
  });

  it('leaves vol/kind null and tags empty when the librarian omitted them', () => {
    const raw = catalog([{ atom_id: A1, quality_score: 0.9, recommendation: { action: 'keep' } }]);
    const a = parseLibrarianCatalog(raw, validAtoms, 'x')!.assessments[0];
    expect(a.vol).toBeNull();
    expect(a.kind).toBeNull();
    expect(a.suggestedTags).toEqual([]);
    expect(a.action).toBe('keep');
  });

  it('still drops assessments whose atom_id is not a real tenant atom', () => {
    const raw = catalog([{ atom_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', vol: 'technical', suggested_tags: ['x:y'] }]);
    expect(parseLibrarianCatalog(raw, validAtoms, 'x')).toBeNull();
  });
});
