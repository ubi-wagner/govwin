import { describe, it, expect } from 'vitest';
import { computeLibraryReview, normalizeForDedup, type ReviewAtom } from '@/lib/atom-review';

const atom = (o: Partial<ReviewAtom> & { id: string }): ReviewAtom => ({
  title: null, content: '', wordCount: 0, status: 'approved', grain: 'primitive',
  tagCount: 2, confirmedTagCount: 1, createdAt: '2026-01-01T00:00:00Z', ...o,
});

const PARA = 'Foundation 3D-prints the foundation-wall shape directly from a downloaded plan, using common sourced concrete.';

describe('normalizeForDedup', () => {
  it('collapses case, punctuation, and whitespace so copies collide', () => {
    expect(normalizeForDedup('Hello,  WORLD!!')).toBe(normalizeForDedup('hello world'));
  });
});

describe('computeLibraryReview — duplicates', () => {
  it('groups near-identical content and suggests one keeper', () => {
    const r = computeLibraryReview([
      atom({ id: 'a', content: PARA, status: 'draft', createdAt: '2026-02-01T00:00:00Z' }),
      atom({ id: 'b', content: PARA + '  ', status: 'approved', createdAt: '2026-03-01T00:00:00Z' }),
      atom({ id: 'c', content: 'Totally different content about budgets and cost elements here.', createdAt: '2026-01-01T00:00:00Z' }),
    ]);
    expect(r.duplicateGroups).toHaveLength(1);
    expect(r.duplicateGroups[0].atoms).toHaveLength(2);
    // keeper = the approved one (b), not the earlier draft
    expect(r.duplicateGroups[0].atoms[0].id).toBe('b');
    expect(r.stats.duplicateAtoms).toBe(1); // one non-keeper
  });

  it('does not flag distinct atoms as duplicates', () => {
    const r = computeLibraryReview([
      atom({ id: 'a', content: 'The Navy needs additive construction for expeditionary basing in contested logistics.' }),
      atom({ id: 'b', content: 'Ohio TVSF validates a production-representative printer and third-party performance data.' }),
    ]);
    expect(r.duplicateGroups).toHaveLength(0);
  });

  it('ignores trivially-short content as a dedup key', () => {
    const r = computeLibraryReview([atom({ id: 'a', content: 'TBD' }), atom({ id: 'b', content: 'TBD' })]);
    expect(r.duplicateGroups).toHaveLength(0);
  });
});

describe('computeLibraryReview — quality flags', () => {
  it('flags empty, tiny, untagged, and unconfirmed atoms', () => {
    // Distinct content per atom so quality flags aren't confounded by dedup grouping.
    const r = computeLibraryReview([
      atom({ id: 'empty', content: '   ', wordCount: 0 }),
      atom({ id: 'tiny', content: 'Two words', wordCount: 2 }),
      atom({ id: 'untag', content: 'Untagged narrative about additive construction for the Navy expeditionary mission.', wordCount: 15, tagCount: 0, confirmedTagCount: 0 }),
      atom({ id: 'unconf', content: 'Unconfirmed tags on this budget narrative covering direct labor and fringe rates here.', wordCount: 15, tagCount: 3, confirmedTagCount: 0 }),
      atom({ id: 'good', content: PARA, wordCount: 15, tagCount: 3, confirmedTagCount: 2 }),
    ]);
    const kinds = (id: string) => r.flags.filter((f) => f.atomId === id).map((f) => f.kind).sort();
    expect(kinds('empty')).toContain('empty');
    expect(kinds('tiny')).toContain('tiny');
    expect(kinds('untag')).toContain('untagged');
    expect(kinds('unconf')).toContain('unconfirmed');
    expect(kinds('good')).toHaveLength(0);
    expect(r.stats.clean).toBe(1); // only 'good'
  });
});
