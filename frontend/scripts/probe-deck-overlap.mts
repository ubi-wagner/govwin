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
 * ── AND A FOURTH INSTRUMENT, FOR THE NODES THE THIRD CANNOT SEE ───────────────────────────────
 *
 * A node that paints its own fill defeats the ink measurement: the ink IS the box, so declared and
 * realised agree however much text is crammed inside, and the check can never fail. Those were
 * reported INDETERMINATE rather than green, which was honest but useless.
 *
 * TEXT POSITION answers it. The rendered page carries a baseline for every run, so a run sitting
 * below the box's bottom edge has escaped the fill drawn for it — in PowerPoint that text is
 * overlapped by whatever follows, or clipped away. Measured, not eyeballed.
 *
 * Getting it to DISCRIMINATE took two corrections worth keeping. First it counted the slide-number
 * footer as body text and reported "text reaches 7.26in" on a perfectly good callout — a finding
 * about the harness wearing the costume of a finding about the deck. Then, once fixed, it passed
 * the old broken estimator too: `length / 60` assumes 60 characters per line, and at 13pt across a
 * 12-inch slide the real figure is ~146, so the old rule OVER-estimates at ordinary sizes and only
 * under-counts above ~32pt. The case that discriminates is therefore a callout the author
 * enlarged — at 36pt the shipped writer declares 1.70in for 3.35in of text and three of five runs
 * land outside the box. A check that passes the bug it was written for is not a check.
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

/**
 * The case a character-count divisor cannot model: the author enlarged the type.
 *
 * `length / 60` assumes one font size at one column width. Bump a callout to 20pt and the same
 * character count needs far more lines than the divisor believes, so the box comes out short and the
 * text runs out the bottom of the fill that was drawn for it. This is the case that makes the boxed
 * check discriminate — with the default size the old rule happened to over-estimate, so it passed
 * for the wrong reason and proved nothing.
 */
const bigCallout = () => N('callout', { variant: 'warning', title: 'Schedule risk',
  text: 'Range access at two field windows is the single dependency that cannot be bought later in the programme, and it is the one thing this proposal asks the government to provide before the closed-loop demonstration can be scheduled at all.' },
  { size: 36 });

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

/**
 * Does a boxed node's TEXT stay inside the box drawn for it?
 *
 * The ink-span measurement below cannot answer this. A callout paints its own fill, so the ink IS
 * the box: declared and realised agree no matter how much text is crammed inside, and the check
 * can never fail. That is why boxed nodes were reported INDETERMINATE rather than green.
 *
 * Text POSITION can answer it. The rendered page carries a baseline for every run, so a run whose
 * baseline sits below the box's bottom edge has escaped the box — which in PowerPoint means it is
 * either overlapping whatever comes next or clipped away entirely. Same failure as B121, one the
 * ink measurement is structurally blind to.
 */
async function boxedTextEscapes(
  pptx: Buffer, tag: string,
): Promise<{ escaped: number; total: number; boxBottomIn: number; lowestIn: number } | null> {
  const zip = await JSZip.loadAsync(pptx);
  const xml = await zip.files['ppt/slides/slide1.xml'].async('string');

  // The boxed node is the body shape that declares a solid fill — the callout — not the sidebar
  // (x=0) and not the title band.
  let box: { y: number; h: number } | null = null;
  for (const m of xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)) {
    const blk = m[1];
    if (!/<a:solidFill>/.test(blk)) continue;
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(blk);
    const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(blk);
    if (!off || !ext) continue;
    const x = Number(off[1]) / EMU;
    const y = Number(off[2]) / EMU;
    if (x < 0.3 || y < BODY_TOP - 0.01 || y > 6.7) continue;   // skip sidebar + title furniture
    box = { y, h: Number(ext[2]) / EMU };
  }
  if (!box) return null;

  const pdf = `${OUT}/${tag}.pdf`;
  if (!existsSync(pdf)) return null;
  const pages = await capturePdfPages(readFileSync(pdf), { scale: 1.4 });
  if (!pages.length) return null;
  const pxPerIn = pages[0].height / SLIDE_H_IN;

  const bottom = box.y + box.h;
  // BODY runs only. The slide-number footer sits at ~7.05in by design, so counting it made the
  // first version of this check report "text reaches 7.26in" and flag a callout that was perfectly
  // fine — a finding about the harness, dressed as a finding about the deck. Same exclusion the ink
  // measurement already makes, for the same reason.
  const runs = pages[0].textItems.filter((t) => {
    const yIn = t.y / pxPerIn;
    return yIn > BODY_TOP && yIn < 6.7;
  });
  if (!runs.length) return null;
  const lowest = Math.max(...runs.map((t) => t.y)) / pxPerIn;
  // A baseline more than a third of a line below the box edge is out, not rounding.
  const escaped = runs.filter((t) => t.y / pxPerIn > bottom + 0.06).length;
  return { escaped, total: runs.length, boxBottomIn: bottom, lowestIn: lowest };
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
    { tag: 'callout-36pt', what: 'a callout the author enlarged to 36pt', node: bigCallout, boxed: true },
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
      // Ink cannot judge a node that paints its own box; text position can.
      const t = await boxedTextEscapes(pptx, c.tag);
      if (!t) {
        unmeasured++;
        console.error('  UNMEASURED — no boxed shape or no text layer found. NOT a pass.');
        continue;
      }
      if (t.escaped > 0) {
        under++;
        console.error(`  ✗ ${t.escaped}/${t.total} text run(s) sit BELOW the box that was drawn for them`);
        console.error(`    box ends at ${t.boxBottomIn.toFixed(2)}in, text reaches ${t.lowestIn.toFixed(2)}in`);
        console.error('    in PowerPoint that text is overlapped by what follows, or clipped away');
      } else {
        console.error(`  ✓ all ${t.total} text run(s) are inside the box (ends ${t.boxBottomIn.toFixed(2)}in, text ${t.lowestIn.toFixed(2)}in)`);
      }
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
