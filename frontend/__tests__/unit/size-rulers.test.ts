import { describe, it, expect } from 'vitest';
import {
  estimatePageCount,
  estimateSlideCount,
  overflowingSlides,
  sectionPageSpan,
  validateCanvasAgainstSpec,
  CANVAS_PRESETS,
  type ComplianceSpec,
} from '@/lib/types/canvas-document';

// ── Fixtures ────────────────────────────────────────────────────────────────
// The slide deck the pptx exporter renders: 16:9, 960×540pt, 40pt margins, 18pt
// Arial, 1.2 spacing. One slide per v2 section (or per page_break group in a flat
// v1 deck). usable frame ≈ 880×460pt.
const slideCanvas = {
  format: 'slide_16_9', width: 960, height: 540,
  margins: { top: 40, right: 40, bottom: 40, left: 40 },
  header: null, footer: null,
  font_default: { family: 'Arial', size: 18 },
  line_spacing: 1.2, max_pages: null, max_slides: 25,
};
// A US-Letter document frame (for per-section page budgets): 612×792, 72pt margins.
const letterCanvas = {
  format: 'letter', width: 612, height: 792,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  header: null, footer: null,
  font_default: { family: 'Times New Roman', size: 12 },
  line_spacing: 1.15, max_pages: null, max_slides: null,
};

let seq = 0;
const base = () => ({ id: `n${seq++}`, style: {}, provenance: { source: 'test' }, history: [], library_eligible: false });
const text = (chars: number) => ({ ...base(), type: 'text_block', content: { text: 'word '.repeat(Math.ceil(chars / 5)).slice(0, chars) } });
const heading = (t: string, level = 1) => ({ ...base(), type: 'heading', content: { text: t, level } });
const pageBreak = () => ({ ...base(), type: 'page_break', content: {} });
const table = (rows: number) => ({ ...base(), type: 'table', content: { headers: [{ text: 'a' }, { text: 'b' }], rows: Array.from({ length: rows }, () => [{ text: 'x' }, { text: 'y' }]) } });

const section = (nodes: unknown[], opts: { title?: string; budget?: number } = {}) => ({
  id: `s${seq++}`,
  title: opts.title,
  layout: { mode: 'flow', ...(opts.budget ? { page_budget: opts.budget } : {}) },
  groups: [{ id: `g${seq++}`, nodes }],
});

const v2 = (canvas: unknown, sections: unknown[]) =>
  ({ version: 2, document_id: 'd', canvas, nodes: [], sections, metadata: {} }) as never;
const v1 = (canvas: unknown, nodes: unknown[]) =>
  ({ version: 1, document_id: 'd', canvas, nodes, metadata: {} }) as never;

const spec = (o: Partial<ComplianceSpec> = {}): ComplianceSpec => ({
  max_pages: null, max_slides: null, min_font_size: null,
  images_allowed: true, required_sections: [], header_required: false, footer_required: false, ...o,
});

// ── estimateSlideCount ──────────────────────────────────────────────────────
describe('estimateSlideCount — one slide per section / page_break group', () => {
  it('an empty deck is one slide', () => {
    expect(estimateSlideCount(v2(slideCanvas, []))).toBe(1);
    expect(estimateSlideCount(v1(slideCanvas, []))).toBe(1);
  });

  it('a v2 deck has one slide per section', () => {
    const deck = v2(slideCanvas, [
      section([heading('Title'), text(50)]),
      section([heading('Approach'), text(80)]),
      section([heading('Team'), text(60)]),
    ]);
    expect(estimateSlideCount(deck)).toBe(3);
  });

  it('a flat v1 deck splits on page_break — N breaks ⇒ N+1 slides', () => {
    const deck = v1(slideCanvas, [text(40), pageBreak(), text(40), pageBreak(), text(40)]);
    expect(estimateSlideCount(deck)).toBe(3);
  });
});

// ── overflowingSlides ───────────────────────────────────────────────────────
describe('overflowingSlides — content taller than the frame is cut off', () => {
  it('a light slide does not overflow', () => {
    const deck = v2(slideCanvas, [section([heading('Title'), text(120)])]);
    expect(overflowingSlides(deck)).toEqual([]);
  });

  it('a slide stuffed with a wall of text overflows the frame', () => {
    const deck = v2(slideCanvas, [
      section([heading('OK'), text(100)]),           // slide 0 — fine
      section([heading('Too much'), text(4000)]),    // slide 1 — overflows 460pt frame
    ]);
    expect(overflowingSlides(deck)).toEqual([1]);
  });

  it('is only defined for slide formats via the validator, but the fn itself measures any frame', () => {
    // A short slide in a big 4:3 frame still fits.
    const deck = v2({ ...slideCanvas, format: 'slide_4_3', width: 960, height: 720 }, [section([text(200)])]);
    expect(overflowingSlides(deck)).toEqual([]);
  });
});

// ── sectionPageSpan ─────────────────────────────────────────────────────────
describe('sectionPageSpan — the page footprint of one section', () => {
  it('a short section is one page', () => {
    expect(sectionPageSpan([heading('X'), text(200)] as never, letterCanvas as never)).toBe(1);
  });

  it('~2 pages of prose spans 2 pages', () => {
    // letter usable ≈ 468×648pt, 12pt/1.15 → ~46 lines × ~86 chars ≈ 3950 chars/page
    expect(sectionPageSpan([text(6800)] as never, letterCanvas as never)).toBe(2);
  });
});

// ── validateCanvasAgainstSpec — new size codes ──────────────────────────────
describe('validateCanvasAgainstSpec — slide + section limits', () => {
  it('flags over_slide_limit when a deck exceeds max_slides', () => {
    const sections = Array.from({ length: 6 }, (_, i) => section([heading(`S${i}`), text(60)]));
    const v = validateCanvasAgainstSpec(v2(slideCanvas, sections), spec({ max_slides: 4 }));
    const codes = v.map((x) => x.code);
    expect(codes).toContain('over_slide_limit');
    const slideV = v.find((x) => x.code === 'over_slide_limit')!;
    expect(slideV.actual).toBe(6);
    expect(slideV.limit).toBe(4);
  });

  it('a deck within max_slides and frame is clean', () => {
    const sections = Array.from({ length: 3 }, (_, i) => section([heading(`S${i}`), text(80)]));
    expect(validateCanvasAgainstSpec(v2(slideCanvas, sections), spec({ max_slides: 25 }))).toEqual([]);
  });

  it('flags slide_overflow when a slide is too tall, even under the slide cap', () => {
    const deck = v2(slideCanvas, [section([text(100)]), section([text(5000)])]);
    const codes = validateCanvasAgainstSpec(deck, spec({ max_slides: 25 })).map((x) => x.code);
    expect(codes).toContain('slide_overflow');
    expect(codes).not.toContain('over_slide_limit');
  });

  it('does NOT run slide checks for a letter document', () => {
    const doc = v1(letterCanvas, [text(200)]);
    const codes = validateCanvasAgainstSpec(doc, spec({ max_slides: 1 })).map((x) => x.code);
    // max_slides on a paginated document still counts groups (1) — but never flags slide_overflow.
    expect(codes).not.toContain('slide_overflow');
  });

  it('flags section_over_budget when a section busts its page_budget', () => {
    const doc = v2(letterCanvas, [
      section([heading('Intro'), text(400)], { budget: 2 }),           // fits
      section([heading('Approach'), text(8200)], { title: 'Approach', budget: 1 }), // ~2pp vs 1
    ]);
    const v = validateCanvasAgainstSpec(doc, spec());
    const budgetV = v.find((x) => x.code === 'section_over_budget');
    expect(budgetV).toBeTruthy();
    expect(budgetV!.limit).toBe(1);
    expect(budgetV!.actual).toBeGreaterThanOrEqual(2);
    expect(budgetV!.message).toContain('Approach');
  });

  it('a section within its budget is clean', () => {
    const doc = v2(letterCanvas, [section([heading('Intro'), text(400)], { budget: 2 })]);
    expect(validateCanvasAgainstSpec(doc, spec()).filter((x) => x.code === 'section_over_budget')).toEqual([]);
  });
});

// ── Spreadsheet (xls) — not flow-paginated: the page/slide caps are a clean no-op ──
describe('validateCanvasAgainstSpec — spreadsheet is measured in tabs, not flow pages', () => {
  const sheetCanvas = { ...CANVAS_PRESETS.spreadsheet };
  it('estimatePageCount returns 1 for a spreadsheet (never a bogus flow count)', () => {
    const doc = v1(sheetCanvas, [table(200)]);
    expect(estimatePageCount(doc)).toBe(1);
  });
  it('a workbook never trips a page/slide/overflow violation', () => {
    const doc = v1(sheetCanvas, [table(500)]);
    // Even if a stray cap were set, a spreadsheet is not paginated → no page/slide flags.
    const codes = validateCanvasAgainstSpec(doc, spec({ max_pages: 1, max_slides: 1 })).map((x) => x.code);
    expect(codes).not.toContain('over_page_limit');
    expect(codes).not.toContain('over_slide_limit');
    expect(codes).not.toContain('slide_overflow');
  });
});
