/**
 * THE BOILERPLATE CASE IS THE REASON THIS FILE EXISTS.
 *
 * "Exact hash means the same opportunity" is the obvious rule and it is wrong on this corpus, not
 * hypothetically:
 *
 *     DoW 2026 SBIR BAA FULL_R1_04132026.pdf   ONE hash, EIGHT solicitations
 *
 * That is the umbrella BAA attached to every topic under it, and it is the single most common
 * document in the whole database. A matcher without the guard would declare all eight topics the
 * same opportunity, with total confidence, on the file it sees most often.
 *
 * So the first test below is the one that matters, and the rest keep the two cheaper signals —
 * filename and size — from firing on their own.
 */
import { describe, it, expect } from 'vitest';
import {
  judgeDocument, strongest, filenameSimilarity, normaliseFilename, sizesAgree,
} from '@/lib/harvest/match';

const doc = (o: Partial<Parameters<typeof judgeDocument>[0]> = {}) => ({
  ownerId: 'opp-1', filename: 'topics.pdf', size: 1_000_000, hash: 'a'.repeat(64), ...o,
});

describe('the boilerplate guard', () => {
  it('refuses to call an umbrella BAA identity, however exact the hash', () => {
    const mine = doc({ filename: 'DoW 2026 SBIR BAA FULL_R1_04132026.pdf' });
    const theirs = doc({
      ownerId: 'topic-7',
      filename: 'DoW 2026 SBIR BAA FULL_R1_04132026.pdf',
      hashOwnerCount: 8,
    });
    const m = judgeDocument(mine, theirs)!;
    expect(m.verdict).toBe('boilerplate');
    expect(m.reason).toContain('8 opportunities');
  });

  it('…but the SAME hash under exactly one opportunity is certain', () => {
    const m = judgeDocument(doc(), doc({ ownerId: 'opp-2', hashOwnerCount: 1 }))!;
    expect(m.verdict).toBe('certain');
    expect(m.score).toBe(1);
  });

  it('treats an absent owner count as one, so a fresh candidate is not silently downgraded', () => {
    const m = judgeDocument(doc(), doc({ ownerId: 'opp-2' }))!;
    expect(m.verdict).toBe('certain');
  });
});

describe('filename + size — the flag, not the verdict', () => {
  it('flags the real shape of the problem: the agency name vs the aggregator name', () => {
    const mine = doc({ filename: 'topics.pdf', size: 1_000_000, hash: 'a'.repeat(64) });
    const theirs = doc({
      ownerId: 'opp-9',
      filename: 'AF251-D001_topics_v2.pdf',
      size: 1_020_000,
      hash: 'b'.repeat(64),
    });
    const m = judgeDocument(mine, theirs)!;
    expect(m.verdict).toBe('flag');
    expect(m.reason).toContain('worth a look');
  });

  it('does NOT flag on the name alone when the sizes are nowhere near', () => {
    const m = judgeDocument(
      doc({ filename: 'instructions.pdf', size: 40_000, hash: 'a'.repeat(64) }),
      doc({ ownerId: 'x', filename: 'instructions.pdf', size: 9_000_000, hash: 'b'.repeat(64) }),
    );
    expect(m).toBeNull();
  });

  it('does NOT flag on the size alone when the names are unrelated', () => {
    const m = judgeDocument(
      doc({ filename: 'topics.pdf', size: 1_000_000, hash: 'a'.repeat(64) }),
      doc({ ownerId: 'x', filename: 'cost-proposal-template.xlsx', size: 1_000_000, hash: 'b'.repeat(64) }),
    );
    expect(m).toBeNull();
  });

  it('says nothing at all about two unrelated documents', () => {
    expect(judgeDocument(
      doc({ filename: 'a.pdf', size: 111, hash: 'a'.repeat(64) }),
      doc({ ownerId: 'x', filename: 'z.docx', size: 999_999, hash: 'b'.repeat(64) }),
    )).toBeNull();
  });
});

describe('normalisation — what varies between two postings of one file', () => {
  it('drops the extension, the version suffix and a date stamp', () => {
    expect(normaliseFilename('AF251-D001_topics_v2.pdf')).toBe('af251 d001 topics');
    expect(normaliseFilename('BAA FULL_R1_04132026.pdf')).toBe('baa full');
  });

  it('scores containment generously, because an aggregator ADDS qualifiers', () => {
    // Jaccard would give 1/3 here and read as "unrelated". Containment is the real relation.
    expect(filenameSimilarity('topics.pdf', 'AF251-D001_topics_v2.pdf')).toBe(1);
  });

  it('still separates two genuinely different documents', () => {
    expect(filenameSimilarity('cost-volume-template.xlsx', 'technical-volume-instructions.pdf'))
      .toBeLessThan(0.72);
  });

  it('sizesAgree refuses a missing or zero size rather than guessing', () => {
    expect(sizesAgree(null, 100)).toBe(false);
    expect(sizesAgree(0, 0)).toBe(false);
    expect(sizesAgree(1_000_000, 1_020_000)).toBe(true);
    expect(sizesAgree(1_000_000, 1_400_000)).toBe(false);
  });
});

describe('strongest — what a caller acts on', () => {
  it('certain outranks flag outranks boilerplate', () => {
    const mk = (verdict: 'certain' | 'flag' | 'boilerplate', score = 1) =>
      ({ verdict, ownerId: 'x', filename: 'f', score, reason: '' });
    expect(strongest([mk('boilerplate'), mk('flag', 0.8), mk('certain')])!.verdict).toBe('certain');
    expect(strongest([mk('boilerplate'), mk('flag', 0.8)])!.verdict).toBe('flag');
    // Boilerplate is RANKED, not discarded — "we have seen this exact file on eight other
    // opportunities" is worth showing even though it decides nothing.
    expect(strongest([mk('boilerplate')])!.verdict).toBe('boilerplate');
    expect(strongest([])).toBeNull();
  });
});
