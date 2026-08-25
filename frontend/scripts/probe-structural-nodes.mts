/**
 * The four STRUCTURAL canvas primitives, each measured by the effect it actually has.
 *
 * `toc`, `page_break`, `spacer` and `divider` carry no text, so the marker search that proves the
 * other 18 primitives survive cannot see them, and the byte differential in
 * `drive-canvas-authoring.mts` is too coarse for some of them (a 900pt spacer moves content without
 * moving the compressed byte count; page count sees that but cannot see a toc). So each is measured
 * here the one way its own effect shows up:
 *
 *   page_break  → PAGE COUNT   · does a break start a new page?
 *   toc         → TEXT         · do the document's headings appear a second time, in a contents list?
 *   spacer      → PAGE COUNT   · does a page-and-a-half of whitespace push content over the edge?
 *   divider     → BYTES        · it adds a rule; it does not add a page
 *
 * Every one of these ASSERTS. This is the file to trust for these four types.
 */
import { createRequire } from 'module';
import { exportToPdf } from '@/lib/export/pdf-exporter';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode, type NodeType } from '@/lib/types/canvas-document';
const { PDFParse } = createRequire(import.meta.url)('pdf-parse') as { PDFParse: any };

const N = (type: NodeType, content: unknown): CanvasNode => ({
  id: crypto.randomUUID(), type, content: content as CanvasNode['content'], style: {},
  provenance: { source: 'manual' }, history: [], library_eligible: false,
} as unknown as CanvasNode);
const doc = (nodes: CanvasNode[], preset: keyof typeof CANVAS_PRESETS = 'letter_standard'): CanvasDocument => ({
  version: 2, document_id: crypto.randomUUID(), canvas: { ...CANVAS_PRESETS[preset] }, nodes: [],
  sections: [{ id: 's', title: 'probe', layout: { mode: 'flow' }, groups: [{ id: 'g', nodes }] }],
  metadata: { title: 'probe', status: 'in_progress' },
} as unknown as CanvasDocument);

async function pages(d: CanvasDocument): Promise<{ n: number; text: string }> {
  const buf = await exportToPdf(d, {});
  const p = new PDFParse({ data: new Uint8Array(buf) });
  try { const r = await p.getText(); return { n: r.pages?.length ?? 0, text: (r.text ?? '').replace(/\s+/g, ' ').trim() }; }
  finally { await p.destroy?.(); }
}

let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

console.log('\n1 · PAGE_BREAK in PDF — does an author-inserted break start a new page?');
const withBreak = await pages(doc([
  N('text_block', { text: 'ALPHA — this paragraph is on page one.' }),
  N('page_break', {}),
  N('text_block', { text: 'BRAVO — this paragraph must be on page two.' }),
]));
const noBreak = await pages(doc([
  N('text_block', { text: 'ALPHA — this paragraph is on page one.' }),
  N('text_block', { text: 'BRAVO — this paragraph must be on page two.' }),
]));
console.log(`   with page_break : ${withBreak.n} page(s)`);
console.log(`   without         : ${noBreak.n} page(s)`);
A('page_break starts a new page in the PDF', withBreak.n > noBreak.n, `${noBreak.n} → ${withBreak.n} pages`);

console.log('\n2 · TOC in PDF — with real headings present (the differential used a doc with none)');
const tocDoc = await pages(doc([
  N('toc', { max_depth: 2 }),
  N('heading', { level: 1, text: 'First Chapter Heading' }),
  N('text_block', { text: 'body' }),
  N('heading', { level: 2, text: 'Second Chapter Heading' }),
  N('text_block', { text: 'body' }),
]));
const noTocDoc = await pages(doc([
  N('heading', { level: 1, text: 'First Chapter Heading' }),
  N('text_block', { text: 'body' }),
  N('heading', { level: 2, text: 'Second Chapter Heading' }),
  N('text_block', { text: 'body' }),
]));
/**
 * COUNT THE SECOND HEADING, NOT THE FIRST — and the reason is the contract, not a workaround.
 *
 * `buildTocHtml` deliberately drops the first level-1 heading: it is the document's own title, and
 * "every real contents page omits" it (canvas-html.ts). This probe counted exactly that heading, so
 * it asserted `2×` for the one entry the design guarantees will be `1×`, and reported a working TOC
 * as broken. CLAUDE.md rule 4: **assert the contract the system HAS** — the same mistake as
 * expecting a bucket DELETE to remove the row when deactivation is the design.
 *
 * Verified against the renderer before changing anything: the TOC block reads
 * "Table of Contents · Second Chapter Heading · 1" — an entry, indented, with its page number.
 *
 * The title omission is now ASSERTED rather than merely avoided, so a future change that starts
 * listing the title fails here instead of passing quietly.
 */
const tocEntries = (tocDoc.text.match(/Second Chapter Heading/g) || []).length;
const plainEntries = (noTocDoc.text.match(/Second Chapter Heading/g) || []).length;
const titleInToc = (tocDoc.text.match(/First Chapter Heading/g) || []).length;
console.log(`   with toc  : the h2 appears ${tocEntries}× (once in the toc + once in the body = 2)`);
console.log(`   without   : the h2 appears ${plainEntries}×`);
console.log(`   the h1     : appears ${titleInToc}× — the doc's own title, omitted from the toc by design`);
A('toc renders its entries in the PDF', tocEntries > plainEntries,
  `the h2 appears ${tocEntries}× with a toc vs ${plainEntries}× without`);
A('toc omits the document title (the first h1) — by design', titleInToc === 1,
  `the h1 appears ${titleInToc}× (body only)`);

console.log('\n3 · SPACER in PDF — does vertical space appear?');
const tall = await pages(doc([
  N('text_block', { text: 'TOP' }),
  ...Array.from({ length: 40 }, () => N('spacer', { height: 24 })),
  N('text_block', { text: 'BOTTOM' }),
]));
const flat = await pages(doc([N('text_block', { text: 'TOP' }), N('text_block', { text: 'BOTTOM' })]));
console.log(`   40 spacers (960pt) : ${tall.n} page(s)`);
console.log(`   none               : ${flat.n} page(s)`);
A('spacer occupies real vertical space in the PDF', tall.n > flat.n, `${flat.n} → ${tall.n} pages`);

console.log('\n4 · PAGE_BREAK / SPACER in XLSX — a grid has no pages; is a no-op defensible?');
const xb = await exportToXlsx(doc([N('text_block', { text: 'A' }), N('page_break', {}), N('text_block', { text: 'B' })]), {});
const xn = await exportToXlsx(doc([N('text_block', { text: 'A' }), N('text_block', { text: 'B' })]), {});
A('page_break is a deliberate no-op in xlsx (a grid has no pages) — xlsx-exporter.ts:120',
  xb.length === xn.length, `${xb.length}B vs ${xn.length}B`);

console.log('\n5 · DIVIDER — it adds a rule, not a page, so bytes are the instrument');
const withRule = await exportToDocx(doc([
  N('text_block', { text: 'A' }),
  N('divider', { thickness: 1, line_style: 'solid' }),
  N('text_block', { text: 'B' }),
]), {});
const noRule = await exportToDocx(doc([N('text_block', { text: 'A' }), N('text_block', { text: 'B' })]), {});
A('divider emits markup in docx', withRule.length > noRule.length + 4, `${noRule.length}B → ${withRule.length}B`);

console.log(`\n${ok ? '✓ all four structural primitives measured, each by its own effect' : '✗ see failures'}\n`);
process.exit(ok ? 0 : 1);
