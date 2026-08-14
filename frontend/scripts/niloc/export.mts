/**
 * Regenerate the NILOC gold-example deliverables (no DB needed — pure canvas → bytes):
 *   · prose proposals (Phase I & II technical, CSO brief, NSF pitch, NASA) → .docx + .pdf
 *   · cost volumes → .xlsx (live formulas) + .pdf (formula values cached)
 *
 * Usage: cd frontend && node --import tsx scripts/niloc/export.mts [outDir]
 *   PDF needs Chromium — set PLAYWRIGHT_CHROMIUM_EXECUTABLE (or PLAYWRIGHT_BROWSERS_PATH);
 *   if it can't launch, the .docx/.xlsx still write and the .pdf is skipped with a note.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { exportToPdf } from '@/lib/export/pdf-exporter';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import { COST_SPECS, PROSE_DOCS, buildFilledCost, proseDoc, proseExistsOnDisk, readProse, HERE } from './_shared.mts';

const OUT = process.argv[2] || join(HERE, 'dist');
const V = { company_name: 'NILOC Technologies' };

async function main() {
  mkdirSync(OUT, { recursive: true });
  for (const p of PROSE_DOCS) {
    if (!proseExistsOnDisk(p.file)) { console.log(`DOC  ${p.tag.padEnd(13)} (${p.file}) missing — skipped`); continue; }
    const doc = proseDoc(readProse(p.file), p.title);
    const docx = await exportToDocx(doc, V); writeFileSync(join(OUT, `NILOC-${p.tag}.docx`), docx);
    let note = '';
    try { const pdf = await exportToPdf(doc, V); writeFileSync(join(OUT, `NILOC-${p.tag}.pdf`), pdf); note = `pdf ${(pdf.length / 1024).toFixed(0)}KB`; }
    catch (e) { note = 'pdf skipped (' + String(e).slice(0, 48) + ')'; }
    console.log(`DOC  ${p.tag.padEnd(13)} docx ${(docx.length / 1024).toFixed(0)}KB · ${note}`);
  }
  for (const spec of COST_SPECS) {
    const doc = buildFilledCost(spec);
    const xlsx = await exportToXlsx(doc, V); writeFileSync(join(OUT, `NILOC-${spec.tag}-cost.xlsx`), xlsx);
    let note = '';
    try { const pdf = await exportToPdf(doc, V); writeFileSync(join(OUT, `NILOC-${spec.tag}-cost.pdf`), pdf); note = `pdf ${(pdf.length / 1024).toFixed(0)}KB`; }
    catch (e) { note = 'pdf skipped (' + String(e).slice(0, 48) + ')'; }
    console.log(`COST ${spec.tag.padEnd(13)} xlsx ${(xlsx.length / 1024).toFixed(0)}KB · ${note}`);
  }
  console.log(`done — ${OUT}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
