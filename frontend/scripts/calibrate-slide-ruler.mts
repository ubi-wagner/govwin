/**
 * calibrate-slide-ruler — the deck counterpart to calibrate-page-ruler.
 *
 * `estimateSlideCount` and `overflowingSlides` are the size rulers for a deck, and
 * `validateCanvasAgainstSpec` enforces `max_slides` from them: an agency that says "no more than 12
 * slides" is checked by these two functions and nothing else. Like the page ruler before B64, they
 * had never been compared to a rendered artifact — no `.pptx` had been produced end to end at all.
 * A model of an artifact that nothing compares to the artifact is exactly the class B64 came from,
 * so this closes the same gap for decks.
 *
 * Method: build decks of known shape, export each through the real pptx exporter, and count the
 * slides the file actually contains (`ppt/slides/slideN.xml` members of the zip). Then check the
 * OVERFLOW claim the same way — `overflowingSlides` says content will be cut off, and a slide whose
 * shapes are positioned past the bottom of the frame is what "cut off" means in a .pptx.
 *
 * Run:  npx tsx scripts/calibrate-slide-ruler.mts
 * Exit: 0 if every case agrees, 1 otherwise.
 */
import {
  estimateSlideCount, overflowingSlides, CANVAS_PRESETS,
  type CanvasDocument, type CanvasNode,
} from '../lib/types/canvas-document';
import { exportToPptx } from '../lib/export/pptx-exporter';
import JSZip from 'jszip';

/**
 * A .pptx is a ZIP, so its XML is DEFLATE-compressed — regexing the raw buffer finds filenames
 * (stored uncompressed in the local headers) but never the markup, which is how a first pass here
 * reported "no shapes past the frame" for a slide that plainly overflows. Unzip properly.
 */
async function slideXml(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)![1]) - Number(b.match(/(\d+)/)![1]));
  return Promise.all(names.map((n) => zip.files[n].async('string')));
}

/**
 * The bottom-most shape edge on each slide, in EMU. pptxgenjs writes `<a:off x=".." y=".."/>`
 * followed by `<a:ext cx=".." cy=".."/>` per shape; a shape whose y+cy exceeds the slide height is
 * off the frame, which is the concrete form of "content will be cut off".
 */
function bottomsEmu(xmls: string[]): number[] {
  return xmls.map((xml) => {
    let max = 0;
    for (const m of xml.matchAll(/<a:off[^>]*y="(-?\d+)"[^>]*\/>\s*<a:ext[^>]*cy="(\d+)"/g)) {
      max = Math.max(max, Number(m[1]) + Number(m[2]));
    }
    return max;
  });
}

let seq = 0;
const node = (type: string, content: unknown): CanvasNode => ({
  id: `n${++seq}`, type, content, style: {}, provenance: { source: 'human' }, history: [],
} as unknown as CanvasNode);

const SENTENCE =
  'The additive manufacturing cell holds a controlled thermal profile across the build volume. ';
const text = (n: number) => node('text_block', { text: SENTENCE.repeat(n).trim() });
const heading = (t: string) => node('heading', { level: 1, text: t });
const bullets = (n: number) => node('bulleted_list', {
  items: Array.from({ length: n }, (_, i) => ({ text: `Qualification milestone ${i + 1} — coupons sectioned and tested` })),
});
const pageBreak = () => node('page_break', {});

function deck(nodes: CanvasNode[]): CanvasDocument {
  return {
    version: 1,
    canvas: CANVAS_PRESETS.slide_deck,
    metadata: { title: 'Calibration deck' },
    nodes,
  } as unknown as CanvasDocument;
}

/** A v2 deck: one section per slide, which is the shape the exporter actually prefers. */
function sectionDeck(count: number): CanvasDocument {
  return {
    version: 2,
    canvas: CANVAS_PRESETS.slide_deck,
    metadata: { title: 'Calibration deck (v2)' },
    sections: Array.from({ length: count }, (_, i) => ({
      id: `s${i}`, title: `Slide ${i + 1}`, layout: { mode: 'flow' },
      groups: [{ id: `g${i}`, nodes: [heading(`Slide ${i + 1}`), text(2)] }],
    })),
  } as unknown as CanvasDocument;
}

interface Case { name: string; doc: CanvasDocument; expectOverflow?: boolean }

const CASES: Case[] = [
  { name: 'v1 · single slide', doc: deck([heading('Overview'), text(2)]) },
  { name: 'v1 · three slides via page_break', doc: deck([heading('A'), text(2), pageBreak(), heading('B'), text(2), pageBreak(), heading('C'), text(2)]) },
  { name: 'v1 · trailing break makes no empty slide', doc: deck([heading('A'), text(2), pageBreak()]) },
  { name: 'v2 · one section per slide (×5)', doc: sectionDeck(5) },
  { name: 'v2 · one section per slide (×12)', doc: sectionDeck(12) },
  // Overflow: far more content than a 16:9 frame holds. The ruler should SAY so.
  { name: 'overflow · 30 bullets on one slide', doc: deck([heading('Milestones'), bullets(30)]), expectOverflow: true },
  { name: 'no overflow · 4 bullets on one slide', doc: deck([heading('Milestones'), bullets(4)]), expectOverflow: false },
];

async function main() {
  const rows: Array<{ name: string; predicted: number; actual: number; note: string }> = [];
  let bad = 0;

  for (const c of CASES) {
    const predicted = estimateSlideCount(c.doc);
    let actual = -1;
    let note = '';
    try {
      const buf = await exportToPptx(c.doc);
      const xmls = await slideXml(buf);
      actual = xmls.length;

      if (c.expectOverflow !== undefined) {
        // GROUND TRUTH, HONESTLY: the exporter CLAMPS each box to the frame
        // (`placeBox`: `Math.min(p?.h ?? defaultH, maxH)`), so overflowing content never shows up
        // as a shape positioned past the slide edge — it is text spilling INSIDE a box that fits,
        // which the XML geometry cannot see. Shape bottoms are still reported below because a
        // shape past the frame would be a different, worse bug; but the check that decides this
        // case is the arithmetic: how many lines the content needs against how many the frame
        // holds. That is a claim about the model, and it is the model this script is auditing.
        const claimed = overflowingSlides(c.doc);
        const cv = c.doc.canvas as { height: number; margins: { top: number; bottom: number } };
        const frameEmu = cv.height * 12700;                 // canvas units are POINTS; 1pt = 12700 EMU
        const reallyOver = bottomsEmu(xmls).map((b, i) => (b > frameEmu * 1.02 ? i : -1)).filter((i) => i >= 0);
        const agrees = c.expectOverflow ? claimed.length > 0 : claimed.length === 0;
        note = `overflow: ruler ${claimed.length ? `[${claimed}]` : 'none'} (expected ${c.expectOverflow ? 'some' : 'none'})`
          + ` · shapes past frame ${reallyOver.length ? `[${reallyOver}]` : 'none (boxes are clamped)'}`
          + (agrees ? '' : '   ← RULER DISAGREES');
        if (!agrees) bad += 1;
      }
    } catch (e) {
      note = `EXPORT FAILED — ${e instanceof Error ? e.message : String(e)}`;
    }
    if (actual !== predicted) bad += 1;
    rows.push({ name: c.name, predicted, actual, note });
    process.stdout.write('.');
  }
  process.stdout.write('\n\n');

  const w = Math.max(...rows.map((r) => r.name.length));
  console.log(`${'CASE'.padEnd(w)}  RULER  ACTUAL`);
  console.log('─'.repeat(w + 16));
  for (const r of rows) {
    const flag = r.actual === r.predicted ? '' : `  ← off by ${r.actual - r.predicted}`;
    console.log(`${r.name.padEnd(w)}  ${String(r.predicted).padStart(5)}  ${String(r.actual).padStart(6)}${flag}`);
    if (r.note) console.log(`${' '.repeat(w)}  ${r.note}`);
  }
  console.log('');
  if (bad === 0) { console.log(`✓ the deck ruler agrees with the rendered .pptx on all ${rows.length} cases`); process.exit(0); }
  console.log(`✗ ${bad} disagreement(s)`);
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
