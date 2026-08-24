/**
 * Does the deck writer tell the truth about how tall a node is?
 *
 * It flows body nodes by asking each one its height and advancing by that much. Several of those
 * answers were guesses that never read the text — a table said `rows * 0.36`, a list said
 * `items * 0.42`, both of which describe a single-line row. A wrapping cell is therefore taller than
 * the writer believed, and the consequence lands in the delivered file two different ways:
 *
 *   · the TABLE grew past the frame it was given and PowerPoint clipped it — a three-row risk
 *     register exported with its third risk missing and its second cut mid-word;
 *   · the LIST stayed inside its frame and the opaque callout beneath it was drawn on top —
 *     the third bullet is in the file, painted, and invisible.
 *
 * ── THREE INSTRUMENTS THAT DID NOT WORK, KEPT BECAUSE THE REASONING IS REUSABLE ────────────────
 *
 * 1. DECLARED GEOMETRY (`<a:off>` + `<a:ext>` from the slide XML). Always clean. The writer leaves
 *    a tidy gap under the frame it believes in; the frame is the lie. Cheap and blind.
 *
 * 2. INK POSITION on the rendered page. Caught the table (it grew past its frame) and passed the
 *    list (it did not) — a tick on a slide that had lost a third of its content.
 *
 * 3. TEXT PRESENCE in the rendered page's text layer. Found every authored phrase, including the
 *    invisible one: occluded text is still painted into the PDF. A check that cannot tell "on the
 *    page" from "under an opaque box" cannot answer the question being asked.
 *
 * ── WHAT ACTUALLY WORKS ────────────────────────────────────────────────────────────────────────
 *
 * Measure the node's TRUE height and compare it to what the writer declared. The node is exported
 * ALONE on a slide with the whole body band available, so nothing can clip it and nothing can cover
 * it; a real Impress engine renders it and the ink says how tall it really is. That number comes
 * from a different codebase than our estimator, which is what makes it evidence.
 *
 * Under-declaring is the failure. Over-declaring wastes space and is reported but not failed — the
 * same asymmetry the page ruler carries (B64): too tall is untidy, too short deletes content.
 *
 *   cd frontend && npx tsx scripts/probe-deck-overlap.mts
 *
 * Exits 1 if any node is under-declared. Reports UNMEASURED — never a pass — without LibreOffice.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import JSZip from 'jszip';
import sharp from 'sharp';
import { capturePdfPages } from '@/lib/pdf/page-capture';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '../lib/types/canvas-document';
import { exportToPptx } from '../lib/export/pptx-exporter';

const OUT = process.env.PROBE_OUT || '/tmp/deck-overlap';
mkdirSync(OUT, { recursive: true });
const EMU = 914400;
const SLIDE_H_IN = 7.5;
const BODY_TOP = 1.7;

let seq = 0;
const N = (type: string, content: unknown, style: unknown = {}): CanvasNode => ({
  id: `p${++seq}`, type, content, style, provenance: { source: 'manual' }, history: [],
  library_eligible: false,
} as unknown as CanvasNode);

const MIT_A = 'Closed-loop rheology control re-tunes the mix on the fly; the Phase I exit criterion is explicitly an UNCHARACTERISED aggregate, so this is tested rather than assumed';
const MIT_B = 'Heated forms and a staged pour schedule; both were demonstrated at the Ohio facility in the January window and the data is in the appendix';
const MIT_C = 'The certification path is an explicit Phase I objective with a licensed PE reviewing the package and enumerating gaps';

/** Nothing exotic — this is what a real risk register or exit-criteria table looks like. */
const wrappingTable = () => N('table', {
  headers: ['Risk', 'Mitigation'],
  rows: [
    ['Aggregate gradation varies beyond the characterised envelope at a new site', MIT_A],
    ['Thermal gradient during cure exceeds the window in cold-weather basing', MIT_B],
    ['Licensed PE will not certify a printed structure without precedent', MIT_C],
  ],
});

const wrappingList = () => N('bulleted_list', { items: [
  { text: 'A correlation between aggregate gradation and printed compressive strength across six profiles, with R\u00b2 \u2265 0.85, which is the number the programme office asked for and the one we will be held to' },
  { text: 'Closed-loop control demonstrated to \u00b115% of target on an aggregate the system has never seen, with no operator input during the pour' },
  { text: 'A certification package reviewed by a licensed professional engineer with every remaining gap enumerated rather than waved at' },
] });

const longParagraph = () => N('text_block', { text:
  'The system prints structural elements from aggregate and water already present at the site, which removes the largest single component of expeditionary lift and is the reason the programme office asked for this demonstration rather than a materials study of the printed medium.' });

const wrappingCallout = () => N('callout', { variant: 'info', title: 'Decision',
  text: 'Range access at two field windows is the single dependency that cannot be bought later in the programme, and it is the one thing this proposal asks the government to provide.' });

/** A heading plus one node, alone on a slide — nothing above it, nothing below it to cover it. */
const isolate = (node: CanvasNode): CanvasDocument => ({
  version: 1, canvas: { ...CANVAS_PRESETS.slide_deck },
  metadata: { title: 'probe', status: 'draft' },
  nodes: [N('heading', { level: 2, text: 'Measured node' }), node],
} as unknown as CanvasDocument);

/** The writer's own declared height for the measured node, in inches. */
async function declaredHeight(buf: Buffer): Promise<number | null> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.files['ppt/slides/slide1.xml'].async('string');
  let best: number | null = null;
  for (const m of xml.matchAll(/<p:(graphicFrame|sp|pic)>([\s\S]*?)<\/p:\1>/g)) {
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(m[2]);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(m[2]);
    if (!off || !ext) continue;
    const y = Number(off[2]) / EMU;
    const h = Number(ext[2]) / EMU;
    // The measured node is the body box: below the title band, above the footer.
    if (y >= BODY_TOP - 0.01 && y < 6.7 && (best == null || h > best)) best = h;
  }
  return best;
}

/**
 * TRUE height, from a rendering engine that shares no code with ours.
 *
 * Two exclusions, both learned by getting them wrong: the content slide's full-height accent
 * SIDEBAR is 1.2% of every pixel row, so with a 1%-of-width ink threshold it alone marks the last
 * row as inked on every slide ever measured; and the slide-number footer sits below all body
 * content by design. Neither is content.
 */
async function realisedHeight(pptx: Buffer, tag: string): Promise<{ h: number; png: string } | null> {
  const path = `${OUT}/${tag}.pptx`;
  writeFileSync(path, pptx);
  try {
    execFileSync('soffice', ['--headless', '--norestore', '-env:UserInstallation=file:///tmp/lo-probe',
      '--convert-to', 'pdf', '--outdir', OUT, path], { stdio: 'pipe', timeout: 300_000 });
  } catch { return null; }
  const pdf = `${OUT}/${tag}.pdf`;
  if (!existsSync(pdf)) return null;

  const pages = await capturePdfPages(readFileSync(pdf), { scale: 1.4 });
  if (!pages.length) return null;
  const png = `${OUT}/${tag}-rendered.png`;
  writeFileSync(png, pages[0].png);

  // sharp reports dimensions on `info`, not at the top level. Destructuring them directly yields
  // undefined, every measurement becomes NaN, and NaN fails every comparison — so an earlier
  // version of this printed a tick for a page it had not measured at all.
  const raw = await sharp(pages[0].png).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = raw.info;
  const data = raw.data;
  const pxPerIn = height / SLIDE_H_IN;
  const colFrom = Math.ceil(0.30 * pxPerIn);
  const rowTo = Math.floor(6.70 * pxPerIn);
  const cols = width - colFrom;
  const inked = (row: number): boolean => {
    let ink = 0;
    for (let col = colFrom; col < width; col++) if (data[row * width + col] < 200) ink++;
    return ink > cols * 0.01;
  };

  // MEASURE THE SPAN OF THE INK, NOT ITS DISTANCE FROM BODY_TOP.
  //
  // The first version computed `inkBottom - BODY_TOP` on the assumption that body content starts at
  // BODY_TOP. It does not: a short slide is deliberately pushed down into its frame, so that
  // subtraction charged the balance offset to the node as if it were content height and reported
  // every node type under-declared — including ones whose rendered page was visibly perfect. The
  // fix under test was fine; the instrument was measuring something else and saying "node height".
  //
  // Top and bottom of the body ink answers the actual question and is indifferent to where the
  // writer chose to begin.
  const rowFrom = Math.ceil(1.55 * pxPerIn);   // below the title band and its accent rule
  let lowest = -1, highest = -1;
  for (let row = Math.min(rowTo, height - 1); row >= rowFrom; row--) if (inked(row)) { lowest = row; break; }
  for (let row = rowFrom; row <= Math.min(rowTo, height - 1); row++) if (inked(row)) { highest = row; break; }
  if (lowest < 0 || highest < 0) return null;
  return { h: ((lowest - highest) / height) * SLIDE_H_IN, png };
}

async function run(): Promise<void> {
  // `boxed` marks a node that paints its own fill or border. For those the ink span measures the
  // BOX, not the text inside it, so declared and realised agree by construction and a tick would
  // mean nothing. Reported as indeterminate rather than passed — a check that cannot fail is not a
  // check, and calling one green is how a suite ends up green for the wrong reason.
  const cases: Array<{ tag: string; what: string; node: () => CanvasNode; boxed?: boolean }> = [
    { tag: 'table', what: 'a table whose cells wrap', node: wrappingTable },
    { tag: 'list', what: 'a list whose bullets wrap', node: wrappingList },
    { tag: 'paragraph', what: 'a paragraph that wraps', node: longParagraph },
    { tag: 'callout', what: 'a callout whose text wraps', node: wrappingCallout, boxed: true },
  ];

  let under = 0, unmeasured = 0;
  for (const c of cases) {
    const pptx = await exportToPptx(isolate(c.node()), {});
    const declared = await declaredHeight(pptx);
    const real = await realisedHeight(pptx, c.tag);

    console.error(`\n── ${c.tag}: ${c.what} ──`);
    if (declared == null) { console.error('  UNMEASURED — no body box found in the slide XML'); unmeasured++; continue; }
    if (!real) {
      console.error('  UNMEASURED — LibreOffice Impress is absent here. NOT a pass.');
      console.error(`  (writer declared ${declared.toFixed(2)}in; nothing independent to check it against)`);
      unmeasured++;
      continue;
    }
    const slack = declared - real.h;
    console.error(`  writer declared ${declared.toFixed(2)}in · rendered needs ${real.h.toFixed(2)}in → ${real.png}`);
    if (c.boxed) {
      unmeasured++;
      console.error('  ? INDETERMINATE — this node paints its own fill/border, so the ink span is the');
      console.error('    BOX, not the text in it. The two agree by construction. Look at the page.');
      continue;
    }
    if (slack < -0.1) {
      under++;
      console.error(`  ✗ UNDER-DECLARED by ${(-slack).toFixed(2)}in — the renderer will clip this node,`);
      console.error('    or whatever the writer places beneath it will be drawn on top of it');
    } else if (slack > 1.0) {
      console.error(`  ~ over-declared by ${slack.toFixed(2)}in — wastes space; not a content risk`);
    } else {
      console.error('  ✓ the declared frame holds the content');
    }
  }

  console.error(`\nArtifacts in ${OUT}. Under-declared: ${under} · unmeasured: ${unmeasured}`);
  if (under) process.exitCode = 1;
}

run().catch((e) => { console.error(e); process.exit(1); });
