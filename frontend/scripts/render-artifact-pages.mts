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
 *   cd frontend && npx tsx scripts/render-artifact-pages.mts <file.pdf> [outDir]
 *
 * PDF only. A .pptx or .xlsx has to be exported to PDF through the product first (the pdf exporter
 * covers every canvas format) — LibreOffice will not open the .pptx this product writes, which is
 * itself worth knowing and is why this does not try to shell out to it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { capturePdfPages } from '@/lib/pdf/page-capture';

async function main() {
  const file = process.argv[2];
  const outDir = process.argv[3] || '/tmp/artifact-pages';
  if (!file) {
    console.error('usage: render-artifact-pages.mts <file.pdf> [outDir]');
    process.exit(2);
  }
  if (extname(file).toLowerCase() !== '.pdf') {
    console.error(`refusing ${extname(file) || 'a file with no extension'} — export it to PDF through the`);
    console.error('product first. This renders what the customer opens, not an approximation of it.');
    process.exit(2);
  }

  mkdirSync(outDir, { recursive: true });
  const stem = basename(file, '.pdf');

  // scale 1.4 is legible at a glance without producing files too large to send anywhere.
  const pages = await capturePdfPages(readFileSync(file), { scale: 1.4 });
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
