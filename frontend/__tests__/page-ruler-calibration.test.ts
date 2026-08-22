/**
 * The page ruler must keep agreeing with the printed page.
 *
 * `paginate()` decides two things a customer's bid depends on: the gauge they watch while writing,
 * and the export gate that refuses to advance a volume over its page limit. Those two call the same
 * engine, so they can never disagree with each other — but nothing checked whether either agrees
 * with what Chromium actually prints, and it did not: measured against real exports, the ruler
 * under-counted a 40-row table by one page, a 40-row table with WRAPPING cells by two, and two of
 * the four hand-authored proposals in the sandbox by a page each.
 *
 * The full calibration (`scripts/calibrate-page-ruler.mts`) renders every case through real
 * Chromium and is the authority; it cannot run in unit tests. What this file locks is the
 * ARITHMETIC that calibration produced, so the constants and the three rules behind them cannot be
 * changed back by accident:
 *
 *   1. a table row is `ROW_BASE + lines × ROW_LINE`, not one line of body text
 *   2. a cell that wraps makes its row taller — the old model counted rows and ignored text
 *   3. columns are auto-sized by content, so a narrow column does not get an equal share
 *   4. a `break-inside: avoid` block too tall for the page still starts on a fresh one
 *
 * Anything that moves these numbers should be re-measured, not re-guessed:
 *   npx tsx scripts/calibrate-page-ruler.mts     (needs a Chromium; exits non-zero on any drift)
 */
import { describe, it, expect } from 'vitest';
import { paginate, overflowingSlides, CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';

let seq = 0;
const node = (type: string, content: unknown): CanvasNode => ({
  id: `n${++seq}`, type, content, style: {}, provenance: { source: 'human' }, history: [],
} as unknown as CanvasNode);

const SENTENCE =
  'The additive manufacturing cell maintains a controlled thermal profile across the build volume, '
  + 'which keeps interlaminar shear strength within the qualification band for the full print. ';
const text = (n: number) => node('text_block', { text: SENTENCE.repeat(n).trim() });

const SHORT = ['M1', '1', 'Coupons', 'Pass'];
const LONG = ['M1', '1',
  'Coupon set printed, sectioned and tested to ASTM D2344 with witness coupons retained',
  'ILSS within the qualification band across all three build orientations'];
const table = (rows: number, kind: 'short' | 'long') => node('table', {
  headers: ['Milestone', 'Month', 'Deliverable', 'Acceptance'],
  rows: Array.from({ length: rows }, () => (kind === 'short' ? SHORT : LONG)),
});

const doc = (nodes: CanvasNode[]): CanvasDocument =>
  ({ version: 1, canvas: CANVAS_PRESETS.letter_standard, nodes } as CanvasDocument);

describe('page ruler — calibrated against real Chromium output', () => {
  it('a 40-row table of single-line cells is 2 pages of table, not 1', () => {
    // Measured: 31 data rows + header fill one 648pt page exactly, so 40 rows must spill.
    expect(paginate(doc([table(40, 'short')])).totalPages).toBe(2);
  });

  it('WRAPPING cells make the same 40 rows taller — the old model could not see this at all', () => {
    // The defect that mattered most: row count identical, printed length different, estimate
    // unchanged. A milestone table with real deliverable text is exactly this shape.
    const short = paginate(doc([table(40, 'short')])).totalPages;
    const long = paginate(doc([table(40, 'long')])).totalPages;
    expect(long).toBeGreaterThan(short);
    expect(long).toBe(3);
  });

  it('an oversized table still starts on a fresh page (break-inside: avoid)', () => {
    // Chromium relocates the whole table and only then lets it overflow. Measured: the table alone
    // prints 2 pages; ONE sentence above it prints 3. The ruler used to say 2 for both.
    const alone = paginate(doc([table(40, 'short')])).totalPages;
    const afterProse = paginate(doc([text(1), table(40, 'short')])).totalPages;
    expect(alone).toBe(2);
    expect(afterProse).toBe(3);
  });

  it('columns are weighted by content, so a narrow column does not take an equal share', () => {
    // Same four columns, but the wide one holds a sentence. Under equal-width columns its text
    // appeared to wrap to twice as many lines as it renders, and a 40-row table read 5 pages
    // against a printed 4. Sharpened here as a direct comparison: widening ONLY the narrow columns
    // must not change the answer, because they were never what forced the wrap.
    const wideNarrowCols = node('table', {
      headers: ['Milestone', 'Month', 'Deliverable', 'Acceptance'],
      rows: Array.from({ length: 40 }, () => ['Milestone', 'Month', LONG[2], LONG[3]]),
    });
    expect(paginate(doc([wideNarrowCols])).totalPages).toBe(paginate(doc([table(40, 'long')])).totalPages);
  });

  it('prose, headings and explicit breaks are unchanged by the table fix', () => {
    // Regression guard on the paths that were already correct — a table-height change must not
    // move a text-only document.
    expect(paginate(doc([text(6)])).totalPages).toBe(1);
    expect(paginate(doc([text(30)])).totalPages).toBe(2);
    expect(paginate(doc([text(3), node('page_break', {}), text(3), node('page_break', {}), text(3)])).totalPages).toBe(3);
  });

  it('an empty table does not claim a page', () => {
    expect(paginate(doc([node('table', { headers: [], rows: [] })])).totalPages).toBe(1);
  });
});

describe('page ruler — a list is not a paragraph (B65)', () => {
  const bullets = (n: number) => node('bulleted_list', {
    items: Array.from({ length: n }, (_, i) => ({
      text: `Qualification milestone ${i + 1} — coupons printed, sectioned and tested to ASTM D2344`,
    })),
  });

  it('each bullet takes its own line, so a long list spills', () => {
    // Measured against Chromium: 120 of these bullets print 4 pages. Falling through to the prose
    // default concatenated them into one string and reflowed it, giving 3.
    expect(paginate(doc([bullets(120)])).totalPages).toBe(4);
  });

  it('the count scales with ITEMS, not with total characters', () => {
    // The sharp form of the defect. Under the old model these two were nearly identical, because
    // the same characters reflowed to the same number of lines either way; what actually differs
    // is that one is 40 separate blocks and the other is one paragraph.
    const asList = paginate(doc([bullets(40)])).totalPages;
    const asProse = paginate(doc([node('text_block', {
      text: Array.from({ length: 40 },
        (_, i) => `Qualification milestone ${i + 1} — coupons printed, sectioned and tested to ASTM D2344`).join(' '),
    })])).totalPages;
    expect(asList).toBeGreaterThan(asProse);
  });

  it('nested children add height rather than disappearing', () => {
    const flat = node('bulleted_list', { items: Array.from({ length: 10 }, () => ({ text: 'Coupon set printed and sectioned' })) });
    const nested = node('bulleted_list', {
      items: Array.from({ length: 10 }, () => ({
        text: 'Coupon set printed and sectioned',
        children: [{ text: 'Witness coupons retained' }, { text: 'ILSS reported per orientation' }],
      })),
    });
    const h = (n: typeof flat) => paginate(doc([n, n, n, n, n])).totalPages;
    expect(h(nested)).toBeGreaterThan(h(flat));
  });

  it('an empty list does not claim a page', () => {
    expect(paginate(doc([node('bulleted_list', { items: [] })])).totalPages).toBe(1);
  });
});

describe('deck ruler — overflow must fire before content is cut off', () => {
  const slideDoc = (n: number): CanvasDocument => ({
    version: 1,
    canvas: CANVAS_PRESETS.slide_deck,
    metadata: { title: 'deck' },
    nodes: [node('bulleted_list', {
      items: Array.from({ length: n }, (_, i) => ({ text: `Qualification milestone ${i + 1} — coupons sectioned and tested` })),
    })],
  } as unknown as CanvasDocument);

  it('a slide holding far more than its frame reports overflow', () => {
    // 30 bullets need ~648pt of a 452pt frame. `overflowingSlides` is the ONLY thing between a
    // customer and a deck with content cut off the bottom, and it stayed silent until 60 while a
    // list was measured as reflowed prose.
    expect(overflowingSlides(slideDoc(30))).toContain(0);
  });

  it('a slide that comfortably fits does not', () => {
    expect(overflowingSlides(slideDoc(4))).toHaveLength(0);
  });
});
