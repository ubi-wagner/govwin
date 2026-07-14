import { describe, expect, it } from 'vitest';
import { computeSectionBudget, wordsPerPage, countWords, evaluateFit } from '@/lib/section-budget';
import type { CanvasNode } from '@/lib/types/canvas-document';

const node = (type: string, content: unknown): CanvasNode => ({ type, content } as unknown as CanvasNode);

describe('section-budget: the mold math', () => {
  it('unbounded when there is no page limit', () => {
    expect(computeSectionBudget({})).toBeNull();
    expect(computeSectionBudget({ pageLimit: 0 })).toBeNull();
    expect(computeSectionBudget({ pageLimit: null })).toBeNull();
  });

  it('~500 words/page at 12pt single-spaced; scales with pages', () => {
    const b = computeSectionBudget({ pageLimit: 10 });
    expect(b).not.toBeNull();
    expect(b!.wordsPerPage).toBe(500);
    expect(b!.targetWords).toBe(5000);
    expect(b!.maxWords).toBe(5250); // 5% strict tolerance
  });

  it('smaller font fits more words; double spacing fits fewer', () => {
    expect(wordsPerPage({ fontSize: 10 })).toBeGreaterThan(500);
    expect(wordsPerPage({ fontSize: 12, lineSpacing: 2 })).toBeLessThan(500);
    // clamped to a sane range
    expect(wordsPerPage({ fontSize: 6 })).toBeLessThanOrEqual(900);
    expect(wordsPerPage({ fontSize: 24, lineSpacing: 3 })).toBeGreaterThanOrEqual(150);
  });
});

describe('section-budget: counting + fit', () => {
  const nodes: CanvasNode[] = [
    node('heading', { level: 1, text: 'Technical Approach' }),        // 2
    node('text_block', { text: 'We will deliver a robust system.' }), // 6
    node('bulleted_list', { items: [{ text: 'one two three' }, { text: 'four' }] }), // 4
    node('table', { rows: [['a b', 'c'], ['d']] }),                    // 4
    node('image', { alt_text: 'ignored diagram here' }),              // 0 (alt not body text)
  ];

  it('counts words across text-bearing node types', () => {
    expect(countWords(nodes)).toBe(16);
    expect(countWords(null)).toBe(0);
    expect(countWords([])).toBe(0);
  });

  it('evaluateFit: within vs over the ceiling', () => {
    const budget = computeSectionBudget({ pageLimit: 1 })!; // 500 target / 525 max
    const within = evaluateFit(nodes, budget);
    expect(within.words).toBe(16);
    expect(within.withinBudget).toBe(true);
    expect(within.fill).toBeCloseTo(16 / 500, 5);

    const big = Array.from({ length: 600 }, () => node('text_block', { text: 'word' }));
    const over = evaluateFit(big, budget);
    expect(over.words).toBe(600);
    expect(over.withinBudget).toBe(false); // 600 > 525

    // unbounded → always within
    const unb = evaluateFit(big, null);
    expect(unb.withinBudget).toBe(true);
    expect(unb.fill).toBeNull();
  });
});
