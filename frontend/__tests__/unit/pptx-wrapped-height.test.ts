/**
 * A slide frame is as tall as the text inside it — otherwise PowerPoint deletes the overflow.
 *
 * The deck writer sized a table at `rows × 0.36in` and a list at `items × 0.42in`. Both numbers
 * describe a single-line row, and neither reads the text. So a three-row risk register whose cells
 * wrapped was given a frame 1.44in tall for 2.69in of content — and PowerPoint does not spill a
 * table onto the next slide, it CLIPS at the frame. The exported deck was missing its third risk
 * entirely and half of its second, with the callout below drawn over the gap. Same defect in the
 * list: the third bullet was simply not in the file.
 *
 * NOTHING CAUGHT IT, and the reason is worth keeping. Every row's text is present in the slide XML
 * — the writer emits it faithfully — so a byte-level check, a node-vocabulary probe and the export
 * gate all see a complete table. The content is absent only from the RENDERED page. It was found by
 * converting a deck with a real Impress engine and looking at it.
 *
 * THE PROPERTY UNDER TEST is the one the old code could not satisfy at any tolerance: the declared
 * height must be a FUNCTION OF THE TEXT. `rows × 0.36` returns the same number for a one-word cell
 * and a paragraph, so every assertion below that lengthens text and expects the frame to grow fails
 * on the old writer no matter how the constants are tuned. Asserting an absolute height instead
 * would only pin today's font metrics.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';
import { exportToPptx } from '@/lib/export/pptx-exporter';

const EMU = 914400;

let seq = 0;
const N = (type: string, content: unknown): CanvasNode => ({
  id: `w${++seq}`, type, content, style: {}, provenance: { source: 'manual' }, history: [],
  library_eligible: false,
} as unknown as CanvasNode);

const deck = (nodes: CanvasNode[]): CanvasDocument => ({
  version: 1, canvas: { ...CANVAS_PRESETS.slide_deck }, metadata: { title: 'w', status: 'draft' }, nodes,
} as unknown as CanvasDocument);

interface Box { kind: string; y: number; h: number; text: string }

/** Every placed box on slide 1, in inches, in emission order. */
async function boxes(doc: CanvasDocument): Promise<Box[]> {
  const zip = await JSZip.loadAsync(await exportToPptx(doc, {}));
  const xml = await zip.files['ppt/slides/slide1.xml'].async('string');
  const out: Box[] = [];
  for (const m of xml.matchAll(/<p:(graphicFrame|sp|pic)>([\s\S]*?)<\/p:\1>/g)) {
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(m[2]);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(m[2]);
    if (!off || !ext) continue;
    out.push({
      kind: m[1], y: Number(off[2]) / EMU, h: Number(ext[2]) / EMU,
      text: [...m[2].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(''),
    });
  }
  return out;
}

const tableBox = (b: Box[]) => b.find((x) => x.kind === 'graphicFrame')!;
/** The body box below the title band that is NOT the table — i.e. what follows it. */
const afterTable = (b: Box[]) => {
  const t = tableBox(b);
  return b.filter((x) => x !== t && x.y > 1.5 && x.y < 7.0 && x.text.length > 20)[0];
};

const SHORT = 'Aggregate varies';
const LONG =
  'Aggregate gradation varies beyond the characterised envelope at a new site, which is the ' +
  'condition the Phase I exit criterion is written against rather than one we intend to avoid';

const riskTable = (mitigation: string) => N('table', {
  headers: ['Risk', 'Mitigation'],
  rows: [
    ['Gradation drift', mitigation],
    ['Thermal gradient during cure exceeds the window', mitigation],
    ['Licensed PE will not certify without precedent', mitigation],
  ],
});

describe('a table frame is sized from its text, not from its row count', () => {
  it('lengthening the cells makes the frame taller', async () => {
    const short = tableBox(await boxes(deck([N('heading', { level: 2, text: 'Risk register' }), riskTable(SHORT)])));
    const long = tableBox(await boxes(deck([N('heading', { level: 2, text: 'Risk register' }), riskTable(LONG)])));
    // The old writer returned rows*0.36 for both. This is the assertion it cannot pass.
    expect(long.h).toBeGreaterThan(short.h);
  });

  it('a wrapping table is taller than the flat one-line-per-row estimate', async () => {
    const t = tableBox(await boxes(deck([N('heading', { level: 2, text: 'Risk register' }), riskTable(LONG)])));
    expect(t.h).toBeGreaterThan(4 * 0.36);   // header + 3 rows, the old constant
  });

  // ⚠ THIS ONE DID NOT CATCH THE ORIGINAL BUG, and saying so is the point. The declared geometry
  // was always clean — the writer left a gap under the frame it believed in. The loss happened at
  // RENDER, where the row grew past that frame and was clipped. Keep it as a structural guard
  // against a future writer that overlaps outright, not as evidence this class is covered here;
  // scripts/probe-deck-overlap.mts is what actually sees it.
  it('what follows the table starts BELOW it — nothing is drawn into the table', async () => {
    const b = await boxes(deck([
      N('heading', { level: 2, text: 'Risk register' }),
      riskTable(LONG),
      N('text_box', { text: 'Ask: range access at two field windows, and the gradation data.' }),
    ]));
    const t = tableBox(b);
    const next = afterTable(b);
    expect(next).toBeDefined();
    expect(next.y).toBeGreaterThanOrEqual(t.y + t.h);
  });

  it('every row of a wrapping table is still in the file', async () => {
    const zip = await JSZip.loadAsync(await exportToPptx(
      deck([N('heading', { level: 2, text: 'Risk register' }), riskTable(LONG)]), {}));
    const xml = await zip.files['ppt/slides/slide1.xml'].async('string');
    // Emission was never the problem — this guards the fix from being "solved" by dropping rows.
    for (const row of ['Gradation drift', 'Thermal gradient', 'Licensed PE']) expect(xml).toContain(row);
  });
});

describe('a list frame is sized from its text too', () => {
  const list = (text: string) => N('bulleted_list', { items: [{ text }, { text }, { text }] });

  it('lengthening the bullets makes the frame taller', async () => {
    const short = (await boxes(deck([N('heading', { level: 2, text: 'Objectives' }), list(SHORT)])))
      .filter((x) => x.y > 1.5)[0];
    const long = (await boxes(deck([N('heading', { level: 2, text: 'Objectives' }), list(LONG)])))
      .filter((x) => x.y > 1.5)[0];
    expect(long.h).toBeGreaterThan(short.h);
  });

  it('what follows a wrapping list starts below it', async () => {
    const b = (await boxes(deck([
      N('heading', { level: 2, text: 'Objectives' }),
      list(LONG),
      N('callout', { variant: 'info', title: 'Decision', text: 'Range access is the dependency.' }),
    ]))).filter((x) => x.y > 1.5 && x.y < 7.0 && x.text.length > 10);
    expect(b.length).toBeGreaterThanOrEqual(2);
    expect(b[1].y).toBeGreaterThanOrEqual(b[0].y + b[0].h);
  });
});
