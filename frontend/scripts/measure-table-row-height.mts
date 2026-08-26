/**
 * Measure the TRUE rendered height of a table row, by rendering and counting rather than by
 * reading the CSS and hoping. The calibration harness showed the ruler under-counts tables in two
 * separate ways; this pins the numbers so the correction is measured, not guessed.
 *
 * Method: render table-only documents of increasing row count and record the row count at which
 * each new page appears. Rows-per-page falls straight out of that, and rows-per-page × usableH
 * gives the real per-row height. Run once for single-line cells and once for cells long enough to
 * wrap, so the wrap penalty is isolated from the base row height.
 */
import { CANVAS_PRESETS, paginate, type CanvasDocument, type CanvasNode } from '../lib/types/canvas-document';
import { exportToPdf } from '../lib/export/pdf-exporter';

function pdfPageCount(buf: Buffer): number {
  return (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
}

let seq = 0;
const node = (type: string, content: unknown): CanvasNode => ({
  id: `n${++seq}`, type, content, style: {}, provenance: { source: 'human' }, history: [],
} as unknown as CanvasNode);

const SHORT = ['M1', '1', 'Coupons', 'Pass'];
const LONG = ['M1', '1',
  'Coupon set printed, sectioned and tested to ASTM D2344 with witness coupons retained',
  'ILSS within the qualification band across all three build orientations'];

function tableDoc(rows: number, kind: 'short' | 'long'): CanvasDocument {
  const cells = kind === 'short' ? SHORT : LONG;
  return {
    version: 1,
    canvas: CANVAS_PRESETS.letter_standard,
    nodes: [node('table', {
      headers: ['Milestone', 'Month', 'Deliverable', 'Acceptance'],
      rows: Array.from({ length: rows }, () => cells),
    })],
  } as CanvasDocument;
}

async function main() {
  const c = CANVAS_PRESETS.letter_standard;
  const usableH = c.height - c.margins.top - c.margins.bottom - (c.header?.height ?? 0) - (c.footer?.height ?? 0);
  console.log(`usable page height: ${usableH.toFixed(1)}pt   (body ${c.font_default.size}pt × ${c.line_spacing} spacing)`);
  console.log(`model today: rows × bodyLineH × 1.35 = rows × ${(c.font_default.size * c.line_spacing * 1.35).toFixed(2)}pt\n`);

  for (const kind of ['short', 'long'] as const) {
    console.log(`── ${kind} cells ──`);
    let lastPages = 0;
    const breaks: number[] = [];
    for (let rows = 4; rows <= 120; rows += 2) {
      const actual = pdfPageCount(await exportToPdf(tableDoc(rows, kind)));
      if (actual > lastPages) { if (lastPages > 0) breaks.push(rows); lastPages = actual; }
      if (breaks.length >= 3) break;
    }
    // Rows that fit on a full page = the gap between successive break points.
    const perPage = breaks.length >= 2 ? breaks[1] - breaks[0] : breaks[0] ?? 0;
    const rowPt = perPage > 0 ? usableH / perPage : NaN;
    console.log(`  new page first appears at rows: ${breaks.join(', ')}`);
    console.log(`  rows per full page ≈ ${perPage}   →  TRUE row height ≈ ${rowPt.toFixed(2)}pt`);
    const modelled = c.font_default.size * c.line_spacing * 1.35;
    console.log(`  model says ${modelled.toFixed(2)}pt  →  under-counts each row by ${(rowPt - modelled).toFixed(2)}pt`
      + `  (${((rowPt / modelled - 1) * 100).toFixed(0)}%)\n`);
    // Sanity: what the ruler predicts at the first break point.
    if (breaks[0]) {
      console.log(`  at ${breaks[0]} rows: ruler says ${paginate(tableDoc(breaks[0], kind)).totalPages}, Chromium prints 2\n`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
