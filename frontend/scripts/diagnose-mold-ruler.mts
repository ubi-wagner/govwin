/**
 * Why does the ruler disagree with the page on THIS mold?
 *
 * `sweep-mold-quality.mts` reports that a mold estimates 7 pages and prints 5. That number names
 * the symptom, not the node type responsible — and on a real mold every type is present at once,
 * each contributing a fraction of a page, so no single node's error is visible in the total.
 *
 * The method here is amplification. Take the mold's nodes OF ONE TYPE, replicate them ×N until
 * their combined error is worth whole pages, and render that. A type that is modelled correctly
 * stays at 0% no matter how many copies; a type that is off by 30% per node reports 30% at any N.
 * One page of disagreement spread over forty nodes becomes an unmissable column.
 *
 * Amplification has a known bias, so `--nodes` is the sharper instrument: it charges each node
 * against the height Chromium gives that same node IN PLACE, by differencing the laid-out height
 * of successive prefixes of the document. No replication, so no collapsed-margin artefact, and the
 * output names the node rather than the type.
 *
 *   npx tsx scripts/diagnose-mold-ruler.mts doe-sbir-phase1-technical --nodes    # per node (start here)
 *   npx tsx scripts/diagnose-mold-ruler.mts doe-sbir-phase1-technical            # per type, amplified
 *   npx tsx scripts/diagnose-mold-ruler.mts doe-sbir-phase1-technical --prefix   # bisect page counts
 */
import { getTemplate } from '@/lib/templates';
import { estimatePageCount, docNodes, nodeHeightsPt, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';
import { renderCanvasToHtml } from '@/lib/export/canvas-html';
import { resolveChromiumExecutable } from '@/lib/export/chromium';
import { exportToPdf } from '@/lib/export/pdf-exporter';

const KEY = process.argv[2];
const MODE_PREFIX = process.argv.includes('--prefix');
const MODE_NODES = process.argv.includes('--nodes');
if (!KEY) { console.error('usage: diagnose-mold-ruler.mts <template-key> [--prefix]'); process.exit(2); }

const base = getTemplate(KEY);
if (!base) { console.error(`no template with key ${KEY}`); process.exit(2); }

const pdfPages = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
const withNodes = (nodes: CanvasNode[]): CanvasDocument =>
  ({ ...base, sections: undefined, nodes } as unknown as CanvasDocument);

async function measure(doc: CanvasDocument): Promise<{ est: number; printed: number }> {
  return { est: estimatePageCount(doc), printed: pdfPages(await exportToPdf(doc, {})) };
}

async function main() {
  const nodes = docNodes(base as CanvasDocument);
  const whole = await measure(base as CanvasDocument);
  console.log(`${KEY}: ${nodes.length} nodes — ruler ${whole.est}, printed ${whole.printed}\n`);

  if (MODE_NODES) {
    const { chromium } = await import('playwright');
    const executablePath = await resolveChromiumExecutable();
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], ...(executablePath ? { executablePath } : {}) });
    try {
      const c = (base as CanvasDocument).canvas;
      const usableWpx = Math.round(((c?.width ?? 612) - (c?.margins?.left ?? 72) - (c?.margins?.right ?? 72)) / 0.75);
      const page = await browser.newPage({ viewport: { width: usableWpx, height: 900 } });
      const heightPt = async (ns: CanvasNode[]) => {
        await page.setContent(renderCanvasToHtml(withNodes(ns), {}), { waitUntil: 'domcontentloaded' });
        return (await page.evaluate(() => document.body.getBoundingClientRect().height)) * 0.75;
      };
      // A `toc` node is excluded from the differencing, and this is not a convenience.
      // `renderCanvasBodyHtml` assembles the contents list from every heading in the document it
      // is handed — so each prefix that adds a heading also adds that heading's TOC row, and the
      // difference charges the row to the heading. It reported every heading ~14pt over and the
      // toc ~300pt under, when a heading measured in isolation matches the model to 0.1pt. The
      // toc has its own calibration cases; here it would only launder its cost onto other nodes.
      const measured = nodes.filter((n) => n.type !== 'toc');
      if (measured.length !== nodes.length) console.log(`(excluding ${nodes.length - measured.length} toc node(s) — see the note in this script)\n`);
      const ruler = nodeHeightsPt(withNodes(measured));
      const rows: Array<{ i: number; type: string; model: number; real: number; diff: number; label: string }> = [];
      let prev = 0;
      for (let i = 1; i <= measured.length; i++) {
        const h = await heightPt(measured.slice(0, i));
        const real = h - prev; prev = h;
        const model = ruler[i - 1].heightPt;
        const label = (typeof (measured[i - 1].content as { text?: string })?.text === 'string'
          ? (measured[i - 1].content as { text: string }).text
          : (typeof (measured[i - 1].content as { alt_text?: string })?.alt_text === 'string'
            ? (measured[i - 1].content as { alt_text: string }).alt_text : '')).replace(/\s+/g, ' ').slice(0, 38);
        rows.push({ i, type: measured[i - 1].type, model, real, diff: model - real, label });
      }
      const total = rows.reduce((s, r) => s + r.diff, 0);
      console.log('  #  TYPE            MODEL     REAL     DIFF   NODE');
      console.log('─'.repeat(88));
      const ordered = process.argv.includes('--order');
      for (const r of ordered ? rows : [...rows].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff))) {
        if (!ordered && Math.abs(r.diff) < 1) continue;
        console.log(`${String(r.i).padStart(3)}  ${r.type.padEnd(14)} ${r.model.toFixed(1).padStart(7)}  ${r.real.toFixed(1).padStart(7)}  `
          + `${(r.diff > 0 ? '+' : '') + r.diff.toFixed(1)}`.padStart(7) + `   ${r.label}`);
      }
      const usableH = (c?.height ?? 792) - (c?.margins?.top ?? 72) - (c?.margins?.bottom ?? 72);
      console.log(`\ntotal model−real: ${total > 0 ? '+' : ''}${total.toFixed(0)}pt = ${(total / usableH).toFixed(2)} page(s) of over-count`);
      const byType = new Map<string, number>();
      for (const r of rows) byType.set(r.type, (byType.get(r.type) ?? 0) + r.diff);
      console.log('by type: ' + [...byType].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .map(([t, d]) => `${t} ${d > 0 ? '+' : ''}${d.toFixed(0)}pt`).join(' · '));
    } finally {
      await browser.close();
    }
    return;
  }

  if (process.argv.includes('--segments')) {
    // Per-PAGE-BREAK-SEGMENT model vs real. A document whose TOTAL height is exact can still land
    // two pages out if it over-charges one segment and under-charges another — and a segment that
    // overflows costs a whole page, because the forced break after it wastes whatever is left.
    const { chromium } = await import('playwright');
    const executablePath = await resolveChromiumExecutable();
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], ...(executablePath ? { executablePath } : {}) });
    try {
      const c = (base as CanvasDocument).canvas;
      const usableH = (c?.height ?? 792) - (c?.margins?.top ?? 72) - (c?.margins?.bottom ?? 72);
      const page = await browser.newPage({ viewport: { width: Math.round(((c?.width ?? 612) - (c?.margins?.left ?? 72) - (c?.margins?.right ?? 72)) / 0.75), height: 900 } });
      const hs = nodeHeightsPt(base as CanvasDocument);
      const segs: CanvasNode[][] = [[]];
      for (const n of nodes) { if (n.type === 'page_break') segs.push([]); else segs[segs.length - 1].push(n); }
      console.log(`usable height ${usableH}pt per page — a segment over that spills\n`);
      console.log('SEG  NODES   MODEL     REAL    DIFF   model pages   real pages');
      console.log('─'.repeat(66));
      let at = 0;
      for (const [i, seg] of segs.entries()) {
        const model = hs.slice(at, at + seg.length).reduce((s, h) => s + h.heightPt, 0);
        at += seg.length + 1; // + the page_break node itself
        await page.setContent(renderCanvasToHtml(withNodes(seg), {}), { waitUntil: 'domcontentloaded' });
        const real = (await page.evaluate(() => document.body.getBoundingClientRect().height)) * 0.75;
        console.log(`${String(i + 1).padStart(3)}  ${String(seg.length).padStart(5)}  ${model.toFixed(0).padStart(6)}  ${real.toFixed(0).padStart(7)}  `
          + `${(model - real > 0 ? '+' : '') + (model - real).toFixed(0)}`.padStart(6)
          + `   ${Math.ceil(model / usableH).toString().padStart(11)}   ${Math.ceil(real / usableH).toString().padStart(10)}`);
      }
    } finally {
      await browser.close();
    }
    return;
  }

  if (process.argv.includes('--pages')) {
    // Replay the ruler's own placement rules over its per-node heights and show where each page
    // ends — specifically how much of a page an ATOMIC node (figure/table, `break-inside: avoid`)
    // leaves empty by relocating. A height model can be exact to the point and still land two
    // pages out if it relocates a figure the renderer fits, and the totals cannot show that.
    const c = (base as CanvasDocument).canvas;
    const usableH = (c?.height ?? 792) - (c?.margins?.top ?? 72) - (c?.margins?.bottom ?? 72);
    const hs = nodeHeightsPt(base as CanvasDocument);
    let page = 1, y = 0;
    console.log(`usable height ${usableH}pt per page\n`);
    for (const h of hs) {
      const n = nodes[h.index];
      if (n.type === 'page_break') {
        if (y > 0) { console.log(`  page ${page} ends at ${y.toFixed(0)}pt — FORCED break (${(usableH - y).toFixed(0)}pt unused)`); page += 1; y = 0; }
        continue;
      }
      if (h.atomic && y > 0 && y + h.heightPt > usableH) {
        console.log(`  page ${page} ends at ${y.toFixed(0)}pt — node ${h.index + 1} (${n.type}, ${h.heightPt.toFixed(0)}pt) RELOCATED, leaving ${(usableH - y).toFixed(0)}pt unused`);
        page += 1; y = 0;
      }
      y += h.heightPt;
      while (y > usableH) { console.log(`  page ${page} filled — node ${h.index + 1} (${n.type}) spills`); page += 1; y -= usableH; }
    }
    console.log(`\nruler total ${page} page(s); printed ${whole.printed}`);
    return;
  }

  if (MODE_PREFIX) {
    // Where does the divergence first appear? Walk prefixes; the node at which est-printed steps
    // up by one is the node that pushed it over.
    let last = 0;
    for (let i = 1; i <= nodes.length; i++) {
      const m = await measure(withNodes(nodes.slice(0, i)));
      const delta = m.est - m.printed;
      if (delta !== last) {
        console.log(`node ${String(i).padStart(3)} (${nodes[i - 1].type.padEnd(14)}) → est ${m.est} printed ${m.printed}  delta ${delta > 0 ? '+' : ''}${delta}`);
        last = delta;
      }
    }
    return;
  }

  const byType = new Map<string, CanvasNode[]>();
  for (const n of nodes) byType.set(n.type, [...(byType.get(n.type) ?? []), n]);

  console.log('TYPE              ×N   est   printed   error/unit');
  console.log('─'.repeat(52));
  for (const [type, group] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
    // Replicate to roughly 240 nodes of this type, so a per-node error of a few percent shows up
    // as whole pages rather than as rounding.
    const reps = Math.max(1, Math.ceil(240 / group.length));
    const doc = withNodes(Array.from({ length: reps }, () => group).flat());
    const m = await measure(doc);
    const err = m.printed > 0 ? (m.est - m.printed) / m.printed : NaN;
    console.log(
      `${type.padEnd(16)} ${String(group.length * reps).padStart(4)}  ${String(m.est).padStart(4)}  ${String(m.printed).padStart(8)}`
      + `   ${Number.isNaN(err) ? '   n/a' : `${err >= 0 ? '+' : ''}${(err * 100).toFixed(0)}%`.padStart(6)}`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
