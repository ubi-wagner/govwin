/**
 * Render an exported artifact to page images, so a person can LOOK at what the customer receives.
 *
 * WHY THIS IS A TOOL AND NOT A SCRATCH SCRIPT. Every automated check in this repo passed on a
 * technical volume that had its sections in the wrong order, an equation printed as raw LaTeX
 * source, a figure that was an empty placeholder box, and a page 60% blank. The ruler counted the
 * pages correctly. The export gate found no violations. The vocabulary probe confirmed all 22 node
 * types were present. Every one of those was true, and the document was still not something you
 * could submit.
 *
 * None of them are detectable from bytes, because none of them are byte defects — they are
 * ARRANGEMENT defects, and arrangement is what a reader sees and a parser does not. The only
 * instrument that finds them is a rendered page in front of someone.
 *
 * So: this exists to be run before declaring an artifact finished, and its output is meant to be
 * looked at rather than asserted on. It deliberately makes no pass/fail judgement — a harness that
 * scored these would be inventing an opinion about layout it has no basis for.
 *
 *   cd frontend && npx tsx scripts/render-artifact-pages.mts <file.pdf|.pptx|.docx|.xlsx> [outDir]
 *
 * A .pptx / .docx / .xlsx is converted to PDF by LibreOffice first, and that path matters more than
 * convenience: it is a SECOND OPINION. The product's own PDF exporter and its .pptx writer are
 * different code, so rendering a deck through the product tells you what the product thinks the
 * deck says. Rendering the actual .pptx through an independent engine tells you what a customer
 * opening it in PowerPoint gets — which is how the clipped-table defect (B121) was found, after
 * every byte-level check had passed it.
 *
 * ⚠ A CORRECTION THIS FILE USED TO CARRY: it said "LibreOffice will not open the .pptx this product
 * writes." That was wrong, and wrong in the direction that blames the product. The container had
 * `libreoffice-core` with no filter packages, so soffice failed on EVERYTHING — including a plain
 * text file, which is what should have been tested before concluding anything about our output.
 * With `libreoffice-impress` installed our decks open fine. If conversion is unavailable here, this
 * says so rather than implying the artifact is at fault.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { capturePdfPages } from '@/lib/pdf/page-capture';

const OFFICE = new Set(['.pptx', '.docx', '.xlsx']);

/** Convert an Office artifact to PDF with LibreOffice. Returns null if the tool cannot do it. */
function toPdf(file: string, outDir: string): string | null {
  const pdf = `${outDir}/${basename(file, extname(file))}.pdf`;
  try {
    execFileSync('soffice', ['--headless', '--norestore', '-env:UserInstallation=file:///tmp/lo-render',
      '--convert-to', 'pdf', '--outdir', outDir, file], { stdio: 'pipe', timeout: 300_000 });
  } catch {
    return null;
  }
  return existsSync(pdf) ? pdf : null;
}

async function main() {
  const file = process.argv[2];
  const outDir = process.argv[3] || '/tmp/artifact-pages';
  if (!file) {
    console.error('usage: render-artifact-pages.mts <file.pdf|.pptx|.docx|.xlsx> [outDir]');
    process.exit(2);
  }
  const ext = extname(file).toLowerCase();
  if (ext !== '.pdf' && !OFFICE.has(ext)) {
    console.error(`refusing ${ext || 'a file with no extension'} — this renders artifacts, not source.`);
    process.exit(2);
  }

  mkdirSync(outDir, { recursive: true });
  const stem = basename(file, extname(file));

  let pdf = file;
  if (OFFICE.has(ext)) {
    const converted = toPdf(file, outDir);
    if (!converted) {
      // UNMEASURED, not "the artifact is broken" — the distinction this script got wrong once.
      console.error(`cannot convert ${ext} here: LibreOffice is absent or has no filter for it.`);
      console.error('Install libreoffice-impress/writer/calc, or export to PDF through the product.');
      console.error('This is a gap in the TOOLING on this box, not a finding about the artifact.');
      process.exit(3);
    }
    pdf = converted;
    console.log(`${ext} → ${pdf} (LibreOffice — an engine independent of our writers)`);
  }

  // scale 1.4 is legible at a glance without producing files too large to send anywhere.
  const pages = await capturePdfPages(readFileSync(pdf), { scale: 1.4 });
  for (const p of pages) {
    const out = `${outDir}/${stem}-p${String(p.pageNumber).padStart(2, '0')}.png`;
    writeFileSync(out, p.png);
  }

  console.log(`${pages.length} page(s) → ${outDir}/${stem}-pNN.png`);
  console.log('\nLook at them. The things this catches are the things nothing else can:');
  console.log('  · sections in the wrong order        · a placeholder where a figure should be');
  console.log('  · markup printed instead of rendered · a page mostly blank after a relocation');
  console.log('  · text touching the border it sits in');
}

main().catch((e) => { console.error('render failed:', e); process.exit(1); });
