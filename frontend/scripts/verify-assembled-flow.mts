/**
 * Drive-verify the APP's assembled-export flow (Phase 1b) — the exact path the
 * download routes use: assembleArtifactCanvas(molds) → renderCanvas(fmt).
 *
 * Proves:
 *  1. assembleArtifactCanvas yields a v2 doc, one FLOW section per mold, and
 *     injects NO page_break between molds (the founder's gap fix).
 *  2. The rendered PDF flows — no near-empty interior page.
 *  3. A cost artifact still exports a NON-EMPTY xlsx (v2 tables reachable via
 *     docNodes) — the regression the v2 switch could have caused.
 *
 *   cd frontend && npx tsx scripts/verify-assembled-flow.mts
 */
import { assembleArtifactCanvas, renderCanvas } from '@/lib/export/artifact-export';
import { paginate } from '@/lib/export/paginate';
import { sectionsToNodes } from '@/lib/types/canvas-document';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import ExcelJS from 'exceljs';

const LETTER = { format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 }, header: null, footer: null, font_default: { family: 'Georgia', size: 11 }, line_spacing: 1.4, max_pages: 10, max_slides: null };
const SHEET = { format: 'spreadsheet', width: 1200, height: 800, margins: { top: 0, right: 0, bottom: 0, left: 0 }, header: null, footer: null, font_default: { family: 'Calibri', size: 11 }, line_spacing: 1, max_pages: null, max_slides: null };

const uid = (s: string, i: number) => `${s}-${i}`;
const heading = (t: string) => ({ id: uid('h', t.length), type: 'heading', content: { level: 2, text: t }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false });
const para = (t: string) => ({ id: uid('p', t.length), type: 'text_block', content: { text: t }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false });
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><rect width="300" height="120" fill="#e0f2fe"/><text x="150" y="65" text-anchor="middle" font-family="Arial" font-size="16" fill="#0369a1">Figure</text></svg>';
const image = () => ({ id: 'img', type: 'image', content: { storage_key: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), alt_text: 'fig', width: 300, height: 120, caption: 'A kept-together figure.' }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false });
const caption = (n: number) => ({ id: uid('cap', n), type: 'caption', content: { prefix: 'Figure', number: n, text: 'demo' }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false });
const table = () => ({ id: 'tbl', type: 'table', content: { sheet_name: 'Direct Labor', headers: ['Role', 'Hours', 'Amount'], rows: [['PI', '200', '43200'], ['Engineer', '300', '34800']], header_style: { bg: '#0f2942', bold: true } }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false });

const LOREM = 'Aerivio extends its validated edge classifier to consume propagation features and emit calibrated per-node posteriors within a strict two-watt budget, retraining with quantization-aware methods so the added inputs still fit. The distributed consensus rule fuses weak partial observations into one confident classification across the mesh, and the Phase I feasibility gates are pre-registered so results are unambiguous. ';
const molds = [
  { title: '1. Significance', content: JSON.stringify({ version: 1, canvas: LETTER, nodes: [heading('1. Significance'), para(LOREM.repeat(4)), image(), caption(1), para(LOREM.repeat(3))] }) },
  { title: '2. Objectives', content: JSON.stringify({ version: 1, canvas: LETTER, nodes: [heading('2. Objectives'), para(LOREM.repeat(4)), table(), caption(2), para(LOREM.repeat(3))] }) },
  { title: '3. Related Work', content: JSON.stringify({ version: 1, canvas: LETTER, nodes: [heading('3. Related Work'), para(LOREM.repeat(5))] }) },
];

async function pdfContinuity(buf: Buffer): Promise<{ pages: number; minInterior: number }> {
  const doc = await getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true }).promise;
  let minInterior = Infinity;
  for (let i = 1; i <= doc.numPages; i++) {
    const items = (await (await doc.getPage(i)).getTextContent()).items.length;
    if (i < doc.numPages) minInterior = Math.min(minInterior, items);
  }
  const pages = doc.numPages;
  await doc.destroy();
  return { pages, minInterior: isFinite(minInterior) ? minInterior : pages };
}

let ok = true;
const check = (label: string, cond: boolean, detail = '') => { console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`); if (!cond) ok = false; };

console.log('══ Assembled-export flow verification (Phase 1b) ══\n▸ Narrative artifact (3 molds)');
const doc = assembleArtifactCanvas(molds, 'narrative', 'Technical Volume');
check('v2 document', doc.version === 2, `version ${doc.version}`);
check('one flow section per mold', doc.sections?.length === 3 && doc.sections.every((s) => s.layout.mode === 'flow'), `${doc.sections?.length} sections`);
check('NO page_break injected between molds', !sectionsToNodes(doc.sections!).some((n) => n.type === 'page_break'));
check('figure/table auto-kept-together', doc.sections!.some((s) => s.groups.some((g) => g.keep_together)));

const docx = await renderCanvas('docx', doc, {});
check('docx renders (non-empty)', docx.length > 2000, `${(docx.length / 1024).toFixed(1)} KB`);
const { pages, minInterior } = await pdfContinuity(await renderCanvas('pdf', doc, {}));
check('pdf flows across pages', pages >= 2, `${pages} pages`);
check('no near-empty interior page', minInterior >= 12, `sparsest interior page = ${minInterior} text items`);

console.log('\n▸ Cost artifact (v2 xlsx must not export empty)');
const costMold = [{ title: 'Budget', content: JSON.stringify({ version: 1, canvas: SHEET, nodes: [table()] }) }];
const costDoc = assembleArtifactCanvas(costMold, 'cost', 'Cost Volume');
const xlsx = await renderCanvas('xlsx', costDoc, {});
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(xlsx as unknown as Parameters<typeof wb.xlsx.load>[0]);
const ws = wb.worksheets[0];
check('xlsx has a worksheet', !!ws, ws ? `"${ws.name}"` : 'none');
check('worksheet has the table rows', !!ws && ws.rowCount >= 3, ws ? `${ws.rowCount} rows` : '0');

// ── Layout gauge covers ALL document types (mirrors the /layout route branch) ──
console.log('\n▸ Layout metrics across every artifact type (pages · slides · tabs)');
const layoutOf = (docu: ReturnType<typeof assembleArtifactCanvas>) => {
  const fmt = docu.canvas?.format ?? 'letter';
  if (fmt === 'spreadsheet') return { unit: 'tabs', tabs: (docu.sections ?? []).reduce((n, s) => n + sectionsToNodes([s]).filter((nd) => nd.type === 'table').length, 0) };
  if (fmt.startsWith('slide')) return { unit: 'slides', totalPages: docu.sections?.length ?? 0, maxPages: docu.canvas?.max_slides ?? null };
  const lay = paginate(docu);
  return { unit: 'pages', totalPages: lay.totalPages, maxPages: lay.vsMaxPages.max };
};
const docL = layoutOf(doc);
check('document → pages', docL.unit === 'pages' && (docL.totalPages ?? 0) >= 2, `${docL.totalPages}/${docL.maxPages} pages`);
const SLIDE = { format: 'slide_16_9', width: 960, height: 540, margins: { top: 40, right: 40, bottom: 40, left: 40 }, header: null, footer: null, font_default: { family: 'Arial', size: 18 }, line_spacing: 1.2, max_pages: null, max_slides: 12 };
const slideMolds = [1, 2, 3].map((i) => ({ title: `Slide ${i}`, content: JSON.stringify({ version: 1, canvas: SLIDE, nodes: [heading(`Slide ${i}`), para('bullet content')] }) }));
const slideL = layoutOf(assembleArtifactCanvas(slideMolds, 'narrative', 'Deck'));
check('slides → one page per section', slideL.unit === 'slides' && slideL.totalPages === 3, `${slideL.totalPages}/${slideL.maxPages} slides`);
const costL = layoutOf(costDoc);
check('spreadsheet → tab count', costL.unit === 'tabs' && (costL.tabs ?? 0) >= 1, `${costL.tabs} tabs`);

console.log(`\n══ ${ok ? 'PASS' : 'FAIL'} ══`);
process.exit(ok ? 0 : 1);
