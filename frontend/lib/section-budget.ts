/**
 * Section budget — the "mold" side of the atoms⟷canvas loop.
 *
 * A proposal section is a BOUND container: its compliance matrix fixes a page
 * limit, font, and line spacing. This converts those bounds into a concrete WORD
 * budget the AI must generate INTO, and counts the words a canvas actually holds so
 * we can verify the fit (federal proposals are disqualified for exceeding a page
 * limit, so the cap is strict). Pure + dependency-free (safe in client or server).
 */

import type { CanvasNode } from '@/lib/types/canvas-document';

export interface SectionBudget {
  /** Words the section should aim for (≈ the page allotment). */
  targetWords: number;
  /** Hard ceiling — content above this risks overflowing the page limit. */
  maxWords: number;
  /** Words that fit on one page at the given font/spacing. */
  wordsPerPage: number;
}

export interface BudgetInputs {
  pageLimit?: number | null;
  fontSize?: number | null;      // points (default 12)
  lineSpacing?: number | null;   // 1.0 single, 2.0 double (default 1.0)
}

// ~500 words fill one page at 12pt single-spaced with 1" margins. Smaller fonts fit
// more; wider line spacing fits fewer.
const BASE_WORDS_PER_PAGE = 500;
const BASE_FONT = 12;

/** Words that fit on one page at the section's font/spacing (clamped to a sane range). */
export function wordsPerPage({ fontSize, lineSpacing }: Pick<BudgetInputs, 'fontSize' | 'lineSpacing'>): number {
  const fs = fontSize && fontSize >= 6 && fontSize <= 24 ? fontSize : BASE_FONT;
  const ls = lineSpacing && lineSpacing >= 1 && lineSpacing <= 3 ? lineSpacing : 1;
  const wpp = (BASE_WORDS_PER_PAGE * (BASE_FONT / fs)) / ls;
  return Math.max(150, Math.min(900, Math.round(wpp)));
}

/**
 * Compute the word budget for a section, or null when the section is unbounded
 * (no page limit). maxWords is a strict 5% tolerance over target — govcon page
 * limits are hard cutoffs.
 */
export function computeSectionBudget(input: BudgetInputs): SectionBudget | null {
  const pages = input.pageLimit;
  if (!pages || pages <= 0) return null;
  const wpp = wordsPerPage(input);
  const targetWords = Math.round(pages * wpp);
  const maxWords = Math.round(targetWords * 1.05);
  return { targetWords, maxWords, wordsPerPage: wpp };
}

function countText(s: unknown): number {
  if (typeof s !== 'string') return 0;
  const t = s.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

/** Count the words a canvas holds (text-bearing nodes: headings, text, lists, tables, quotes…). */
export function countWords(nodes: CanvasNode[] | null | undefined): number {
  if (!Array.isArray(nodes)) return 0;
  let n = 0;
  for (const node of nodes) {
    const c = node?.content as unknown as Record<string, unknown> | undefined;
    if (!c) continue;
    // text-bearing simple nodes (heading, text_block, quote, callout…)
    if (typeof c.text === 'string') n += countText(c.text);
    // list items
    if (Array.isArray(c.items)) {
      for (const it of c.items) n += countText((it as { text?: unknown } | null)?.text);
    }
    // table cells (string | { text })
    if (Array.isArray(c.rows)) {
      for (const row of c.rows) {
        if (!Array.isArray(row)) continue;
        for (const cell of row) n += countText(typeof cell === 'string' ? cell : (cell as { text?: unknown } | null)?.text);
      }
    }
  }
  return n;
}

/** How a canvas fits its mold. `withinBudget` is false when over the hard ceiling. */
export interface FitResult {
  words: number;
  targetWords: number | null;
  maxWords: number | null;
  withinBudget: boolean;
  /** 0..1+ — words / target (for a fill meter). null when unbounded. */
  fill: number | null;
}

export function evaluateFit(nodes: CanvasNode[] | null | undefined, budget: SectionBudget | null): FitResult {
  const words = countWords(nodes);
  if (!budget) return { words, targetWords: null, maxWords: null, withinBudget: true, fill: null };
  return {
    words,
    targetWords: budget.targetWords,
    maxWords: budget.maxWords,
    withinBudget: words <= budget.maxWords,
    fill: budget.targetWords > 0 ? words / budget.targetWords : null,
  };
}
