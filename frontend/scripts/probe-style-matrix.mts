/**
 * Which STYLE actually survives which exporter — the ribbon's equivalent of the node-type survey.
 *
 * `probe-node-vocabulary` answers "does every NodeType reach every format". Nothing answers the
 * question a customer actually asks first, which is not about types at all: **I made it bold and
 * red and centred — does the file I send the government look like what I saw?**
 *
 * That gap matters more than it sounds. `NodeStyle extends Partial<FontSpec>`, so the MODEL already
 * carries the whole common Word/Google-Docs set — family, size, bold, italic, underline,
 * strikethrough, colour, highlight, alignment, indent, paragraph spacing, plus fill/border/opacity/
 * rotation for shapes. A style key that one writer honours and another silently ignores is
 * invisible from every angle except opening the artifact: the editor shows it, the model stores it,
 * no error is raised, and the .docx simply comes out plain.
 *
 * WHAT THIS DOES. One node per style key, each carrying a deliberately UNMISTAKABLE value —
 * `#C41E3A` is not a colour anything defaults to, 33pt is not a size anything rounds to — then runs
 * the four writers and looks for that value in the artifact. The Office formats are ZIPs, so their
 * XML is unzipped rather than regexed off the raw buffer (a raw scan finds filenames and never
 * markup — the mistake `calibrate-slide-ruler` records).
 *
 * WHY A MATCHER PER (KEY, WRITER) PAIR. "Survived" means something different in each format: bold
 * is `<w:b/>` in WordprocessingML, `b="1"` in DrawingML, `font-weight:700` in CSS. One matcher
 * across all four would either be so loose it matches anything or so tight it fails everywhere. The
 * cost is that each pair is a small claim someone can check; that is also the benefit.
 *
 * `Record<StyleKey, StyleCase>` ON PURPOSE — a key added to FontSpec or NodeStyle that nobody
 * writes a case for is a COMPILE error here, not a silently uncovered capability. That is the one
 * property that keeps a survey honest as the model grows.
 *
 * NOT-APPLICABLE IS NOT FAILURE. A spreadsheet cell has no paragraph indent and a slide has no page
 * margin; those pairs are marked `null` and reported as `n/a`, distinct from `✗`. Conflating them
 * is how a matrix grows a column of red that everyone learns to ignore.
 *
 *   cd frontend && npx tsx scripts/probe-style-matrix.mts
 * Exit 0 always — this is a SURVEY. It reports the map; closing a gap is a decision.
 */
import JSZip from 'jszip';
import {
  CANVAS_PRESETS, type CanvasDocument, type CanvasNode, type NodeStyle,
} from '@/lib/types/canvas-document';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { exportToPptx } from '@/lib/export/pptx-exporter';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import { renderCanvasToHtml } from '@/lib/export/canvas-html';

/** Values chosen so a hit cannot be a coincidence or a default. */
const COLOR = '#C41E3A';       // a red nothing defaults to
const HILITE = '#FFE066';
const FAMILY = 'Garamond';     // not the stack default
const SIZE = 33;               // not 10/11/12/14/18/24

type StyleKey =
  | 'family' | 'size' | 'weight' | 'style' | 'color' | 'underline' | 'strikethrough' | 'highlight'
  | 'alignment' | 'indent' | 'space_before' | 'space_after'
  | 'fill' | 'border' | 'opacity' | 'shadow' | 'rotation';

interface StyleCase {
  label: string;
  style: NodeStyle;
  /** null = the concept does not exist in that format. Distinct from "did not survive". */
  docx: RegExp | null;
  pptx: RegExp | null;
  xlsx: RegExp | null;
  html: RegExp | null;
}

const CASES: Record<StyleKey, StyleCase> = {
  family: {
    label: 'font family',
    style: { family: FAMILY, size: 12 },
    docx: /Garamond/i, pptx: /Garamond/i, xlsx: /Garamond/i, html: /Garamond/i,
  },
  size: {
    label: 'font size',
    style: { family: 'Arial', size: SIZE },
    // WordprocessingML stores half-points: 33pt → 66.
    docx: /w:sz[^>]*w:val="66"|"sz":\s*66|66/, pptx: /3300|"33"|:\s*33\b/, xlsx: /33/, html: /33(pt|px)?/,
  },
  weight: {
    label: 'bold',
    style: { family: 'Arial', size: 12, weight: 'bold' },
    docx: /<w:b\/>|<w:b\s|w:b\b/, pptx: /b="1"|bold/i, xlsx: /<b\/>|bold/i, html: /font-weight\s*:\s*(bold|[6-9]00)/i,
  },
  style: {
    label: 'italic',
    style: { family: 'Arial', size: 12, style: 'italic' },
    docx: /<w:i\/>|<w:i\s/, pptx: /i="1"|italic/i, xlsx: /<i\/>|italic/i, html: /font-style\s*:\s*italic/i,
  },
  color: {
    label: 'text colour',
    style: { family: 'Arial', size: 12, color: COLOR },
    docx: /C41E3A/i, pptx: /C41E3A/i, xlsx: /C41E3A/i, html: /C41E3A|rgb\(\s*196/i,
  },
  underline: {
    label: 'underline',
    style: { family: 'Arial', size: 12, underline: true },
    docx: /<w:u\s|<w:u\//, pptx: /u="sng"|underline/i, xlsx: /<u\/>|underline/i,
    html: /text-decoration[^;"]*underline/i,
  },
  strikethrough: {
    label: 'strikethrough',
    style: { family: 'Arial', size: 12, strikethrough: true },
    docx: /<w:strike/, pptx: /strike="sng"|strike/i, xlsx: /<strike\/>|strike/i,
    html: /line-through/i,
  },
  highlight: {
    label: 'highlight',
    style: { family: 'Arial', size: 12, highlight: HILITE },
    docx: /FFE066|w:highlight/i, pptx: /FFE066/i, xlsx: /FFE066/i, html: /FFE066|rgb\(\s*255,\s*224/i,
  },
  alignment: {
    label: 'alignment (centre)',
    style: { family: 'Arial', size: 12, alignment: 'center' },
    docx: /w:jc[^>]*w:val="center"/i, pptx: /algn="ctr"|align.*center/i,
    xlsx: /horizontal="center"|center/i, html: /text-align\s*:\s*center/i,
  },
  indent: {
    label: 'indent',
    style: { family: 'Arial', size: 12, indent: 36 },
    docx: /<w:ind\s/, pptx: /marL="|indent/i,
    xlsx: null,  // a cell has no paragraph indent
    html: /(margin|padding)-left/i,
  },
  space_before: {
    label: 'space before',
    style: { family: 'Arial', size: 12, space_before: 18 },
    docx: /w:spacing[^>]*w:before=/i, pptx: /spcBef|spcPts/i,
    xlsx: null,
    html: /margin-top/i,
  },
  space_after: {
    label: 'space after',
    style: { family: 'Arial', size: 12, space_after: 18 },
    docx: /w:spacing[^>]*w:after=/i, pptx: /spcAft|spcPts/i,
    xlsx: null,
    html: /margin-bottom/i,
  },
  fill: {
    label: 'shape fill',
    style: { family: 'Arial', size: 12, fill: { color: COLOR } as NodeStyle['fill'] },
    docx: /C41E3A/i, pptx: /C41E3A/i, xlsx: /C41E3A/i, html: /C41E3A|rgb\(\s*196/i,
  },
  border: {
    label: 'border',
    style: { family: 'Arial', size: 12, border: { color: COLOR, width: 2 } as NodeStyle['border'] },
    docx: /C41E3A|w:pBdr|w:tcBorders/i, pptx: /C41E3A|<a:ln/i, xlsx: /C41E3A|border/i,
    html: /border[^;"]*C41E3A|border/i,
  },
  opacity: {
    label: 'opacity',
    // WITH A FILL, deliberately. Opacity alone was the wrong case: a shape with no fill colour has
    // nothing to make transparent, `fillFrom` returns undefined before it ever reads `opacity`, and
    // the probe scored a ✗ against a writer that is correct. Verified by hand — a filled shape at
    // 0.5 exports `alpha val="50000"`, and the same shape unfilled is unchanged. An author reaching
    // for opacity is styling something visible; the realistic pair is what the matrix should judge.
    style: { family: 'Arial', size: 12, fill: { color: '#3366CC' } as NodeStyle['fill'], opacity: 0.5 },
    docx: null,   // WordprocessingML has no whole-run alpha
    pptx: /alpha val="50000"|alpha/i,
    xlsx: null,
    html: /opacity\s*:\s*0?\.5/i,
  },
  shadow: {
    label: 'shadow',
    style: { family: 'Arial', size: 12, shadow: true },
    docx: null,
    pptx: /outerShdw|shadow/i,
    xlsx: null,
    html: /box-shadow|filter\s*:\s*drop-shadow/i,
  },
  rotation: {
    label: 'rotation',
    style: { family: 'Arial', size: 12, rotation: 15 },
    docx: null,
    pptx: /rot="900000"|rot=|rotate/i,
    xlsx: null,
    html: /rotate\(/i,
  },
};

const MARK = 'STYLEPROBE';

function docFor(style: NodeStyle, format: 'letter' | 'slide' | 'sheet'): CanvasDocument {
  const preset = format === 'slide' ? 'slide_deck' : format === 'sheet' ? 'spreadsheet' : 'letter_standard';
  const nodes: CanvasNode[] = [
    {
      id: 'n1', type: 'heading', content: { level: 1, text: `${MARK} heading` }, style,
      provenance: { source: 'manual' }, history: [], library_eligible: false,
    } as unknown as CanvasNode,
    {
      id: 'n2', type: 'text_block', content: { text: `${MARK} body text` }, style,
      provenance: { source: 'manual' }, history: [], library_eligible: false,
    } as unknown as CanvasNode,
    // A shape carries fill/border/opacity/rotation, which a paragraph cannot.
    {
      id: 'n3', type: 'shape', content: { shape: 'rectangle', text: `${MARK} shape` }, style,
      provenance: { source: 'manual' }, history: [], library_eligible: false,
    } as unknown as CanvasNode,
    // A table carries cell borders and shading.
    {
      id: 'n4', type: 'table', content: { headers: [`${MARK} th`], rows: [['cell']] }, style,
      provenance: { source: 'manual' }, history: [], library_eligible: false,
    } as unknown as CanvasNode,
  ];
  return {
    version: 1, canvas: { ...CANVAS_PRESETS[preset] },
    metadata: { title: `${MARK} ${format}` }, nodes,
  } as unknown as CanvasDocument;
}

/**
 * The Office formats are ZIPs — read their XML, never the raw buffer.
 *
 * AND NORMALISE THE CLOCK OUT OF IT. Every OOXML package stamps `docProps/core.xml` with
 * `dcterms:created`, so two exports of the SAME document differ whenever they straddle a second.
 * With difference as the primary signal that is fatal: the probe reads the clock and reports it as
 * the style having taken effect.
 *
 * It was caught the way these things are caught — a column changed with no code behind it. The xlsx
 * results flipped from "ignored" to "changed" after a fix that touched only the pptx writer.
 * Demonstrated directly:
 *
 *     two IDENTICAL documents, exported 1.1s apart → byte-identical: false
 *     timestamp found in the XML: 2026-08-24T18:54:58Z
 *
 * So `docProps/` is dropped (it holds no style) and any residual ISO-8601 stamp is flattened. What
 * remains differs only when the CONTENT does.
 */
async function zipText(buf: Buffer): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files)
      .filter((f) => !f.startsWith('docProps/'))     // metadata, and where the clock lives
      .sort();                                       // zip order is not guaranteed stable

    const xml = await Promise.all(
      names.filter((f) => /\.(xml|rels)$/.test(f)).map((f) => zip.files[f].async('string')));

    // MEDIA COUNTS TOO. Some writers express a style by DRAWING it: a shape placed in a worksheet
    // is rasterised, so its fill and border live in the pixels of xl/media/image1.png and nowhere
    // in the XML. Reading only markup, the probe saw no difference and reported `shape fill → xlsx`
    // as ignored — against a writer that applies it correctly. Verified by comparing the media
    // parts directly: the raster DOES change when the fill is set.
    //
    // Included as base64 rather than decoded: this is a difference test, and identity of bytes is
    // the whole question.
    const media = await Promise.all(
      names.filter((f) => /media\/.+\.\w+$/.test(f)).map((f) => zip.files[f].async('base64')));

    return [...xml, ...media].join('\n').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, 'TIMESTAMP');
  } catch { return ''; }
}

const HIT = '✓', MISS = '✗', NA = '·', PARTIAL = '~';

/**
 * A neutral style, used to produce the CONTROL artifact for every case.
 *
 * WHY THERE IS A CONTROL AT ALL. The first version of this probe asked only "does the value appear
 * in the artifact", and reported `bold → xlsx ✓`. That was false. The xlsx writer's heading case
 * builds its font from scratch — `font = { bold: true, size: headingSize(level) }` — ignoring
 * `node.style` completely, so `<b/>` is in the file whether the author asked for bold or not.
 * Proven by exporting the same document with `weight: 'normal'` and `weight: 'bold'`:
 *
 *     weight=normal → <b/> present: true
 *     weight=bold   → <b/> present: true
 *
 * A matcher that cannot tell HONOURED from HARDCODED reports the writer's own defaults back as
 * evidence of the customer's formatting, which is the same shape of mistake as a check whose scope
 * is narrower than its claim. So every case is now exported TWICE and the artifacts must DIFFER:
 * present-with and absent-without is the only pattern that proves the style did the work.
 */
const NEUTRAL: NodeStyle = { family: 'Arial', size: 12 };

async function main() {
  console.log(`\n── STYLE × WRITER — does what the ribbon sets reach the artifact? ──\n`);

  const keys = Object.keys(CASES) as StyleKey[];
  const results: Array<{ key: StyleKey; label: string; docx: string; pptx: string; xlsx: string; html: string }> = [];

  // The control artifacts — one neutral export per writer, reused for every case.
  let cDocx = '', cPptx = '', cXlsx = '', cHtml = '';
  try { cDocx = await zipText(Buffer.from(await exportToDocx(docFor(NEUTRAL, 'letter'), {}))); } catch { /* reported below */ }
  try { cPptx = await zipText(Buffer.from(await exportToPptx(docFor(NEUTRAL, 'slide'), {}))); } catch { /* reported below */ }
  try { cXlsx = await zipText(Buffer.from(await exportToXlsx(docFor(NEUTRAL, 'sheet'), {}))); } catch { /* reported below */ }
  try { cHtml = renderCanvasToHtml(docFor(NEUTRAL, 'letter')); } catch { /* reported below */ }

  for (const key of keys) {
    const c = CASES[key];
    let docxTxt = '', pptxTxt = '', xlsxTxt = '', htmlTxt = '';
    try { docxTxt = await zipText(Buffer.from(await exportToDocx(docFor(c.style, 'letter'), {}))); } catch { /* reported below */ }
    try { pptxTxt = await zipText(Buffer.from(await exportToPptx(docFor(c.style, 'slide'), {}))); } catch { /* reported below */ }
    try { xlsxTxt = await zipText(Buffer.from(await exportToXlsx(docFor(c.style, 'sheet'), {}))); } catch { /* reported below */ }
    try { htmlTxt = renderCanvasToHtml(docFor(c.style, 'letter')); } catch { /* reported below */ }

    /**
     * DIFFERENCE IS THE PRIMARY SIGNAL, and the regex is corroboration.
     *
     * Regex-over-the-whole-artifact was the wrong instrument, and its second output said so: it
     * reported 24 keys as "hardcoded", which cannot be true. The matchers were simply too loose to
     * isolate the node under test from the rest of the file — `w:b\b` also matches `w:before` and
     * `w:bottom`, a bare `border` matches any border the writer draws, and the docx writer sets
     * paragraph spacing on everything, so `w:spacing` is always present. Every one of those was my
     * pattern, not the product.
     *
     * The robust question needs no per-format knowledge at all: **does the file change when the
     * style changes?** If setting `weight: 'bold'` produces bytes identical to `weight: 'normal'`,
     * the writer ignored it — definitively, with no matcher to argue about. That is the assertion
     * the xlsx falsification test made by hand, generalised.
     *
     *   ✓ the artifact CHANGED and the distinctive value is present — honoured, and correctly
     *   ~ the artifact CHANGED but the value was not found — the writer did something, though not
     *     provably the right thing; a lead, not a verdict
     *   ✗ the artifact is IDENTICAL — the style was ignored outright
     */
    const judge = (re: RegExp | null, txt: string, control: string) => {
      if (re === null) return NA;
      if (!txt) return MISS;
      if (txt === control) return MISS;          // no difference at all ⇒ ignored
      return re.test(txt) ? HIT : PARTIAL;
    };

    results.push({
      key, label: c.label,
      docx: judge(c.docx, docxTxt, cDocx),
      pptx: judge(c.pptx, pptxTxt, cPptx),
      xlsx: judge(c.xlsx, xlsxTxt, cXlsx),
      html: judge(c.html, htmlTxt, cHtml),
    });
  }

  printf('CAPABILITY', 'docx', 'pptx', 'xlsx', 'pdf/html');
  console.log('  ' + '─'.repeat(58));
  for (const r of results) printf(r.label, r.docx, r.pptx, r.xlsx, r.html);

  const W = ['docx', 'pptx', 'xlsx', 'html'] as const;
  const gaps = results.flatMap((r) => W.filter((w) => r[w] === MISS).map((w) => `${r.label} → ${w}`));
  const partial = results.flatMap((r) => W.filter((w) => r[w] === PARTIAL).map((w) => `${r.label} → ${w}`));

  console.log(`\n  ${HIT} artifact changed AND carries the value · ${PARTIAL} changed but value not located ·`);
  console.log(`  ${MISS} artifact IDENTICAL — the style was ignored · ${NA} not applicable to that format\n`);
  if (partial.length) {
    console.log(`  ${partial.length} changed-but-unconfirmed (the writer acted; my matcher could not prove it right):`);
    for (const f of partial) console.log(`    · ${f}`);
    console.log();
  }
  if (gaps.length) {
    console.log(`  ${gaps.length} IGNORED — the style changes the model and nothing in the file:`);
    for (const g of gaps) console.log(`    · ${g}`);
  } else {
    console.log('  no gaps — every style the model carries reaches every format that has the concept.');
  }
  console.log();
}

function printf(a: string, b: string, c: string, d: string, e: string) {
  console.log(`  ${a.padEnd(22)} ${b.padStart(6)} ${c.padStart(6)} ${d.padStart(6)} ${e.padStart(9)}`);
}

main().catch((e) => { console.error('PROBE ERROR', e); process.exit(1); });
