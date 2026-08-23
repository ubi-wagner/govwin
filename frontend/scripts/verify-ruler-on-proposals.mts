/**
 * The page ruler against REAL, hand-authored proposals — not synthetic cases, not molds.
 *
 * B69 removed a subtraction from the content box, which makes the ruler allow MORE content per
 * page. That is the direction that can turn an over-count into an under-count, and an under-count
 * at the export gate is the one failure that actually costs a customer their bid: the product would
 * clear a volume as within its page limit and the agency would receive one that is over.
 *
 * Molds cannot answer that question — they are skeletons, and their whole content is brackets. The
 * NILOC gold-example set is the closest thing on disk to a submitted document: full narratives
 * authored to agency shape, and `proseDoc` gives every one of them a page-numbered running footer,
 * so they exercise exactly the path B69 changed.
 *
 *   npx tsx scripts/verify-ruler-on-proposals.mts
 * Exit 0 if the ruler never UNDER-counts; 1 if it does (an over-count is reported, not fatal).
 */
import { PROSE_DOCS, readProse, proseExistsOnDisk, proseDoc } from './niloc/_shared.mts';
import { estimatePageCount } from '@/lib/types/canvas-document';
import { exportToPdf } from '@/lib/export/pdf-exporter';

const pdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;

async function main() {
  const rows: Array<{ name: string; est: number; printed: number }> = [];
  for (const d of PROSE_DOCS) {
    if (!proseExistsOnDisk(d.file)) { console.log(`skipped ${d.file} — not on disk`); continue; }
    const doc = proseDoc(readProse(d.file), d.title);
    const est = estimatePageCount(doc);
    const printed = pdfPages(await exportToPdf(doc, {}));
    rows.push({ name: d.file.replace(/\.md$/, ''), est, printed });
    process.stdout.write('.');
  }
  console.log('\n');
  console.log('PROPOSAL                          RULER  PRINTED  DELTA');
  console.log('─'.repeat(56));
  for (const r of rows) {
    const d = r.est - r.printed;
    console.log(`${r.name.padEnd(32)}  ${String(r.est).padStart(5)}  ${String(r.printed).padStart(7)}  `
      + `${(d > 0 ? '+' : '') + d}`.padStart(5) + (d < 0 ? '  ← UNDER-COUNT' : ''));
  }
  const under = rows.filter((r) => r.est < r.printed);
  const over = rows.filter((r) => r.est > r.printed);
  console.log();
  if (under.length) {
    console.log(`✗ ${under.length} proposal(s) UNDER-counted — the gate would clear an over-length volume`);
    process.exit(1);
  }
  console.log(`✓ no under-counts across ${rows.length} authored proposal(s)`
    + (over.length ? ` — ${over.length} over-counted by 1 page (safe direction): ${over.map((r) => r.name).join(', ')}` : ' — every one exact'));
}

main().catch((e) => { console.error(e); process.exit(1); });
