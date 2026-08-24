/**
 * A short slide is balanced in its frame; a full one is not moved.
 *
 * Body content always began at a fixed BODY_TOP regardless of how much there was, so a title slide
 * with two lines sat on top of five inches of white. Every slide in a rendered deck read as
 * unfinished even where the content was right — found by looking at a deck, not by any assertion.
 *
 * BOTH DIRECTIONS ARE THE TEST. Centring a short slide is easy; the thing that could break a
 * customer's deck is nudging a FULL slide down, because content that currently fits would be pushed
 * off the frame. So the dense case asserts the offset is exactly BODY_TOP, and it would fail if the
 * rule were applied unconditionally.
 *
 * ── HOW THE FIRST VERSION OF THIS FILE WAS WRONG ──────────────────────────────────────────────
 * It measured the wrong slide entirely. `isTitleSlide` fires when slide 1 carries a level-1 heading
 * and only text_block siblings — which described every deck it built — and the hero path uses its
 * own fixed constants and never reads BODY_TOP. So it read a hardcoded subtitle at y=3.0 and an
 * accent footer rule at y=7.22 and called them "content". Three assertions passed and one failed,
 * all four for reasons unrelated to the code under test.
 *
 * Two guards came out of that, and they are the reason this file is worth more than its assertions:
 * `assertContentSlide` refuses to measure a hero slide at all, and the measurement window is pinned
 * to x = MARGIN so slide numbers and rules cannot be mistaken for body flow.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';
import { exportToPptx } from '@/lib/export/pptx-exporter';

const EMU_PER_INCH = 914400;
const MARGIN = 0.6;   // pptx-exporter MARGIN — body flow is placed at this x
const BODY_TOP = 1.7; // pptx-exporter BODY_TOP — where body flow began before the change

let seq = 0;
const N = (type: string, content: unknown): CanvasNode => ({
  id: `v${++seq}`, type, content, style: {}, provenance: { source: 'manual' }, history: [],
  library_eligible: false,
} as unknown as CanvasNode);

const deck = (nodes: CanvasNode[]): CanvasDocument => ({
  version: 1, canvas: { ...CANVAS_PRESETS.slide_deck }, metadata: { title: 'v', status: 'draft' }, nodes,
} as unknown as CanvasDocument);

/** Every `<a:off>` on slide 1, in inches. */
async function offsets(doc: CanvasDocument): Promise<{ x: number; y: number }[]> {
  const zip = await JSZip.loadAsync(await exportToPptx(doc, {}));
  const xml = await zip.files['ppt/slides/slide1.xml'].async('string');
  return [...xml.matchAll(/<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"/g)].map((m) => ({
    x: Number(m[1]) / EMU_PER_INCH, y: Number(m[2]) / EMU_PER_INCH,
  }));
}

/**
 * Refuse to measure a hero slide.
 *
 * The content path opens with a 0.16in accent SIDEBAR at the origin; the hero path opens with a
 * full-width band at the same origin. Distinguishing them is the difference between measuring the
 * code under test and measuring a constant.
 */
function assertContentSlide(offs: { x: number; y: number }[]): void {
  const atOrigin = offs.filter((o) => o.x < 0.01 && o.y < 0.01);
  expect(atOrigin.length, 'slide 1 has no shape at the origin — layout changed, re-verify this harness').toBeGreaterThan(0);
  // A hero slide's band spans the full width; a sidebar does not. Detect via the title text, which
  // the hero path places at y=0.7 in white on the band and the content path at TITLE_Y=0.42.
  const heroTitle = offs.some((o) => Math.abs(o.x - MARGIN) < 0.01 && Math.abs(o.y - 0.7) < 0.01);
  expect(heroTitle, 'measured a HERO slide — its layout is fixed and never reads BODY_TOP').toBe(false);
}

/** Topmost BODY-FLOW offset on slide 1, in inches — content only, never furniture. */
async function bodyTopInches(doc: CanvasDocument): Promise<number> {
  const offs = await offsets(doc);
  assertContentSlide(offs);
  const body = offs.filter((o) => Math.abs(o.x - MARGIN) < 0.01 && o.y > BODY_TOP - 0.01);
  expect(body.length, 'no body flow found at x=MARGIN below the title band').toBeGreaterThan(0);
  return Math.min(...body.map((o) => o.y));
}

// Level 2 keeps every deck below on the CONTENT path — level 1 on slide 1 is the hero trigger.
const H = (text: string) => N('heading', { level: 2, text });

describe('short slides are balanced, full slides are not disturbed', () => {
  it('a two-line slide is pushed down into its frame', async () => {
    const y = await bodyTopInches(deck([
      H('Printing the base, not shipping it'),
      N('text_block', { text: 'Immobileyes Inc. · N261-EXP01' }),
    ]));
    expect(y).toBeGreaterThan(2.4);
  });

  it('a DENSE slide still starts exactly at BODY_TOP — the case that could lose content', async () => {
    const y = await bodyTopInches(deck([
      H('Program status'),
      N('table', {
        headers: ['WBS', 'Owner', 'Status', 'Risk'],
        rows: Array.from({ length: 12 }, (_, i) => [`1.${i + 1}`, 'Integration', 'On track', 'Low']),
      }),
      N('bulleted_list', { items: Array.from({ length: 10 }, (_, i) => ({ text: `Criterion ${i + 1} closed` })) }),
    ]));
    // No slack, so no offset — the pre-change behaviour, preserved exactly where it mattered.
    expect(y).toBeCloseTo(BODY_TOP, 2);
  });

  it('the offset scales with how much room is actually left', async () => {
    const sparse = await bodyTopInches(deck([H('One line'), N('text_block', { text: 'A single sentence.' })]));
    const middling = await bodyTopInches(deck([
      H('Several points'),
      N('bulleted_list', { items: Array.from({ length: 8 }, (_, i) => ({ text: `Point ${i + 1}` })) }),
    ]));
    expect(sparse).toBeGreaterThan(middling);
    expect(middling).toBeGreaterThanOrEqual(BODY_TOP);
  });

  it('sits ABOVE the true centre — optical, not arithmetic', async () => {
    // The eye weights the space above a block more than below it, so true centring reads as low;
    // 0.38 of the slack is what "centred" actually looks like.
    const y = await bodyTopInches(deck([H('One line'), N('text_block', { text: 'A single sentence.' })]));
    const band = 7.5 - 0.5 - BODY_TOP;   // slide height − bottom margin − BODY_TOP
    expect(y).toBeGreaterThan(BODY_TOP);
    expect(y).toBeLessThan(BODY_TOP + band * 0.5);
  });
});
