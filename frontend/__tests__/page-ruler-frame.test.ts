/**
 * The page FRAME, and the two node shapes a mold is built out of (bug log B68 · B69 · B70).
 *
 * `page-ruler-calibration.test.ts` locks the arithmetic of a table row, a list and an atomic block.
 * Everything it locks was measured on `CANVAS_PRESETS.letter_standard` — which declares
 * `header: null, footer: null`. So did every case in `scripts/calibrate-page-ruler.mts`. The
 * product's molds all carry a running header and a page-numbered footer, and that path had no
 * measurement at all: the ruler subtracted both heights from the content box on top of the margins,
 * losing 72pt — 11% — of every page, on the gauge a customer watches and the gate that blocks an
 * over-length volume. Four pages of prose read as four with furniture and three without; Chromium
 * printed three either way, because `page.pdf` draws the templates INSIDE the margins.
 *
 * The other two are the shapes a TEMPLATE is made of rather than a finished document: a figure slot
 * with nothing to load, and a table with a narrow column. Both were measured against Chromium
 * (scripts/measure-image-placeholder.mts, scripts/diagnose-mold-ruler.mts --nodes); these lock the
 * result so it cannot be re-guessed.
 *
 *   npx tsx scripts/calibrate-page-ruler.mts     (the authority — needs Chromium, exits non-zero on drift)
 */
import { describe, it, expect } from 'vitest';
import { paginate, CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';

let seq = 0;
const node = (type: string, content: unknown): CanvasNode => ({
  id: `n${++seq}`, type, content, style: {}, provenance: { source: 'human' }, history: [],
} as unknown as CanvasNode);

const SENTENCE =
  'The additive manufacturing cell maintains a controlled thermal profile across the build volume, '
  + 'which keeps interlaminar shear strength within the qualification band for the full print. ';
const text = (n: number) => node('text_block', { text: SENTENCE.repeat(n).trim() });

const HEADER = { template: '{topic_number} — {company_name}', height: 36, font: { family: 'Times New Roman', size: 10 } };
const FOOTER = { template: '{company_name} | Page {n} of {N}', height: 36, font: { family: 'Times New Roman', size: 10 } };

const doc = (nodes: CanvasNode[], overrides: Record<string, unknown> = {}): CanvasDocument =>
  ({ version: 1, canvas: { ...CANVAS_PRESETS.letter_standard, ...overrides }, nodes } as CanvasDocument);

describe('page frame — running header and footer live in the margin', () => {
  const NODES = [text(62)]; // four pages' worth of prose

  it('does not shrink the content box', () => {
    const bare = paginate(doc(NODES)).totalPages;
    const furnished = paginate(doc(NODES, { header: HEADER, footer: FOOTER })).totalPages;
    expect(furnished).toBe(bare);
  });

  it('is unaffected by either one alone', () => {
    const bare = paginate(doc(NODES)).totalPages;
    expect(paginate(doc(NODES, { header: HEADER })).totalPages).toBe(bare);
    expect(paginate(doc(NODES, { footer: FOOTER })).totalPages).toBe(bare);
  });

  it('still tracks the margins, which DO take from the content box', () => {
    // The guard against over-correcting: furniture is free, margins are not.
    const wide = paginate(doc(NODES, { margins: { top: 144, right: 72, bottom: 144, left: 72 } })).totalPages;
    expect(wide).toBeGreaterThan(paginate(doc(NODES)).totalPages);
  });
});

describe('figure slot — an image with an empty storage_key is a dashed box, not a figure', () => {
  const slot = (extra: Record<string, unknown> = {}) => node('image', {
    storage_key: '', alt_text: 'Figure 1. System architecture', ...extra,
  });

  it('measures a declared 900×520 slot as one line of alt text, not 390pt of picture', () => {
    // 15 slots print on one page (measured); at the declared height they would be 12 pages.
    expect(paginate(doc(Array.from({ length: 10 }, () => slot({ width: 900, height: 520 })))).totalPages).toBe(1);
  });

  it('treats a declared height as a CAP — it can only make the box shorter', () => {
    const tall = paginate(doc(Array.from({ length: 30 }, () => slot({ width: 900, height: 520 })))).totalPages;
    const squat = paginate(doc(Array.from({ length: 30 }, () => slot({ width: 320, height: 60 })))).totalPages;
    expect(squat).toBeLessThanOrEqual(tall);
  });

  it('charges a caption, and charges alt text that wraps', () => {
    const plain = paginate(doc(Array.from({ length: 30 }, () => slot()))).totalPages;
    const captioned = paginate(doc(Array.from({ length: 30 }, () =>
      slot({ caption: 'Interlaminar shear strength by build orientation' })))).totalPages;
    const wrapping = paginate(doc(Array.from({ length: 30 }, () => node('image', {
      storage_key: '',
      alt_text: 'Figure. Interlaminar shear strength measured across all three build orientations for '
        + 'the qualification coupon set, sectioned and tested to ASTM D2344 with witness coupons retained',
    })))).totalPages;
    expect(captioned).toBeGreaterThan(plain);
    expect(wrapping).toBeGreaterThan(plain);
  });

  it('leaves an image that HAS a source measured at its declared size', () => {
    // Only the provably-unresolvable case changes; a real key resolves at export and takes its size.
    // ~303pt each once the declared width is scaled into the column: two fit on a page, three
    // cannot. As a dashed placeholder the same three would be ~192pt in total, comfortably one.
    const real = node('image', { storage_key: 'tenants/x/figure.png', alt_text: 'x', width: 900, height: 520 });
    expect(paginate(doc([real, real, real])).totalPages).toBeGreaterThan(1);
    const asSlot = node('image', { storage_key: '', alt_text: 'x', width: 900, height: 520 });
    expect(paginate(doc([asSlot, asSlot, asSlot])).totalPages).toBe(1);
  });
});

describe('table columns — a column is never narrower than its longest word', () => {
  // The NSF milestone table, the shape that made the mold read 8 pages against a printed 6: a
  // 6-character first column whose proportional share was 5.8 characters, so every row wrapped.
  const milestones = node('table', {
    headers: ['Task', 'Milestone / Deliverable', 'Quantitative Success Metric', 'Months'],
    rows: [
      ['Task 1', '[Design / model complete]', '[e.g., predicted {metric} ≥ {target}]', '1–2'],
      ['Task 2', '[Prototype / dataset built]', '[e.g., {component} operational]', '2–5'],
      ['Task 3', '[Validation report]', '[e.g., measured {metric} ≥ {threshold}]', '4–7'],
      ['Task 4', '[Feasibility summary + Phase II plan]', '[Go/No-Go criteria met]', '7–{pop_months}'],
    ],
  });

  it('does not wrap a six-character cell in a column of six-character cells', () => {
    // 5 boxes at ROW_BASE 8 + ROW_LINE 12 is 100pt if nothing wraps; the old model said 148pt for
    // the same table by wrapping "Task 1". Chromium prints 105.9pt. Anything near 148 is the bug.
    const [only] = paginate(doc([milestones])).perSection;
    expect(only.pagesUsed).toBe(1);
    const twelve = paginate(doc(Array.from({ length: 12 }, () => milestones))).totalPages;
    expect(twelve).toBeLessThanOrEqual(3);   // ~124pt each; at 148pt each it needs a 4th
  });

  it('still makes a genuinely long cell wrap', () => {
    // The guard against over-correcting the other way: min-content is a floor, not a licence to
    // fit anything on one line.
    const wide = node('table', {
      headers: ['Milestone', 'Deliverable'],
      rows: Array.from({ length: 8 }, () => ['M1',
        'Coupon set printed, sectioned and tested to ASTM D2344 with witness coupons retained for '
        + 'the option year and reported per build orientation']),
    });
    const narrow = node('table', {
      headers: ['Milestone', 'Deliverable'],
      rows: Array.from({ length: 8 }, () => ['M1', 'Coupons']),
    });
    const [w] = paginate(doc([wide])).perSection;
    const [n] = paginate(doc([narrow])).perSection;
    expect(w.pagesUsed).toBeGreaterThanOrEqual(n.pagesUsed);
    expect(paginate(doc([wide, wide, wide])).totalPages).toBeGreaterThan(1);
  });
});
