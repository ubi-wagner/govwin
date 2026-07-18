/**
 * Measure canvas FLOW — the Phase-1 proof (docs/CANVAS_GEOMETRY_REDESIGN.md §6, §9).
 *
 * For each generated document it reports:
 *   • paginate() estimate (per-section start/end page + total + vs max_pages)
 *   • the REAL page count from the exported PDF (Chromium → pdfjs)
 *   • a continuity check — the sparsest non-final page's text-item count, which
 *     surfaces the bottom-of-page whitespace gaps the old forced page_breaks
 *     produced. With sections flowing, no interior page should be near-empty.
 *
 * It also paginates the AFWERX v1 sample (flat nodes + page_breaks) to prove the
 * v1→section lift is backward-compatible.
 *
 *   cd frontend && npx tsx scripts/measure-canvas-flow.mts
 */
import { readFileSync, existsSync } from 'fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { paginate } from '@/lib/export/paginate';
import { toSections } from '@/lib/types/canvas-document';
import type { CanvasDocument } from '@/lib/types/canvas-document';

const NAVY = '/home/user/govwin/docs/sample-proposal-navy-sttr';
const AFWERX = '/home/user/govwin/docs/sample-proposal';

const load = (p: string): CanvasDocument => JSON.parse(readFileSync(p, 'utf8')) as CanvasDocument;

/** Real page count + sparsest interior page (min text items on a non-final page). */
async function inspectPdf(p: string): Promise<{ pages: number; minInteriorItems: number; minInteriorPage: number }> {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(p)), isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = doc.numPages;
  let minInteriorItems = Infinity;
  let minInteriorPage = 0;
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const items = (await page.getTextContent()).items.length;
    if (i < pages && items < minInteriorItems) { minInteriorItems = items; minInteriorPage = i; }
  }
  await doc.destroy();
  if (!isFinite(minInteriorItems)) minInteriorItems = 0; // single-page doc
  return { pages, minInteriorItems, minInteriorPage };
}

const DOCS = [
  { name: 'Navy TV', canvas: `${NAVY}/canvas/technical-volume.canvas.json`, pdf: `${NAVY}/Aerivio_Navy_STTR_Technical_Volume.pdf` },
  { name: 'Navy SOW', canvas: `${NAVY}/canvas/statement-of-work.canvas.json`, pdf: `${NAVY}/Aerivio_Navy_STTR_Statement_of_Work.pdf` },
  { name: 'AFWERX TV', canvas: `${AFWERX}/canvas/technical-volume.canvas.json`, pdf: `${AFWERX}/Aerivio_Technical_Volume.pdf` },
  { name: 'AFWERX Key Personnel', canvas: `${AFWERX}/canvas/key-personnel-bios.canvas.json`, pdf: `${AFWERX}/Aerivio_Key_Personnel.pdf` },
  { name: 'AFWERX Facilities', canvas: `${AFWERX}/canvas/facilities.canvas.json`, pdf: `${AFWERX}/Aerivio_Facilities.pdf` },
];

console.log('══ Canvas flow measurement (Phase 1) ══');
for (const d of DOCS) {
  if (!existsSync(d.canvas)) { console.log(`\n${d.name}: canvas JSON missing — run gen-navy-sttr-proposal.mts first`); continue; }
  const cd = load(d.canvas);
  const est = paginate(cd);
  console.log(`\n▸ ${d.name}  —  v${cd.version}, ${cd.sections?.length ?? 0} sections, ${toSections(cd).length} flow units`);
  console.log(`  paginate estimate: ${est.totalPages} pages` +
    (est.vsMaxPages.max != null ? `  (max_pages ${est.vsMaxPages.max} — ${est.vsMaxPages.over ? '⚠ OVER' : 'within cap'})` : ''));
  for (const s of est.perSection) {
    const span = s.endPage !== s.startPage ? `p${s.startPage}–${s.endPage}` : `p${s.startPage}`;
    console.log(`    ${span.padEnd(8)} ${s.title ?? '(untitled)'}`);
  }
  if (existsSync(d.pdf)) {
    const info = await inspectPdf(d.pdf);
    const gapFlag = info.minInteriorItems > 0 && info.minInteriorItems < 12 ? `⚠ sparse interior page ${info.minInteriorPage} (${info.minInteriorItems} items)` : 'no near-empty interior pages';
    console.log(`  real PDF: ${info.pages} pages · continuity: ${gapFlag}`);
  } else {
    console.log('  real PDF: (not found — run the generator to emit PDFs)');
  }
}

console.log('\n══ done ══ (v1 flat-node backward-compat is covered by __tests__/canvas-sections.test.ts)');
