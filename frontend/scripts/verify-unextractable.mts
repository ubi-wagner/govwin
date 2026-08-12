/** Proves the reader → plan threading of the BOX-3 "un-extractable content" signal, with NO
 *  server: a scanned (text-less) PDF and a PPTX carrying a <p:pic> both surface `unextractable`
 *  through planDocumentAtomization (what the preview route returns). DATABASE_URL must be set
 *  (module-load only; no query). cd frontend && DATABASE_URL=… node --import tsx scripts/verify-unextractable.mts */
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { planDocumentAtomization } from '@/lib/atomize-package';

let ok = true;
const A = (label: string, cond: boolean, extra = '') => { console.log(`${cond ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`); ok = ok && cond; };

// ── a PPTX with one text shape + one <p:pic> image ──
const slidePic = `<p:sld><p:cSld><p:spTree>
  <p:sp><p:txBody><a:p><a:r><a:t>Figure 1 — the deposition head geometry and toolpath.</a:t></a:r></a:p></p:txBody></p:sp>
  <p:pic><p:nvPicPr/><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>
</p:spTree></p:cSld></p:sld>`;
const zip = new JSZip();
zip.file('ppt/slides/slide1.xml', slidePic);
const pptx = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));

const pptxPlan = await planDocumentAtomization({ buffer: pptx, filename: 'deck.pptx', ctxTags: [] });
A('pptx: plan carries an unextractable signal', !!pptxPlan.unextractable, JSON.stringify(pptxPlan.unextractable));
A('pptx: kind = slide_image, count = 1', pptxPlan.unextractable?.kind === 'slide_image' && pptxPlan.unextractable?.count === 1);
A('pptx: text still planned (images flagged, not blocking)', pptxPlan.planned.length > 0, `${pptxPlan.planned.length} planned`);

// ── a scanned / image-only PDF: render a colored page with NO text via Chromium ──
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const g = await (await b.newContext()).newPage();
await g.setContent(`<!doctype html><body style="margin:0"><div style="height:100vh;background:linear-gradient(135deg,#1c64c8,#dc3c3c)"></div><div style="height:100vh;background:#222"></div></body>`, { waitUntil: 'networkidle' });
const scannedPdf = await g.pdf({ format: 'Letter', printBackground: true });
await b.close();

const pdfPlan = await planDocumentAtomization({ buffer: Buffer.from(scannedPdf), filename: 'scan.pdf', ctxTags: [] });
A('scanned pdf: 0 atoms planned (no text)', pdfPlan.planned.length === 0, pdfPlan.error || '');
A('scanned pdf: plan carries an unextractable signal', !!pdfPlan.unextractable, JSON.stringify(pdfPlan.unextractable));
A('scanned pdf: kind = scanned_pdf, count = 2 pages', pdfPlan.unextractable?.kind === 'scanned_pdf' && pdfPlan.unextractable?.count === 2);

console.log(ok ? '\nPASS — un-extractable visual content surfaces through the plan (both PDF + PPTX)' : '\nFAIL');
process.exit(ok ? 0 : 1);
