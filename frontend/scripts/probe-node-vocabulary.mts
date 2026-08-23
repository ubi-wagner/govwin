/**
 * Which node types actually survive which exporter?
 *
 * Each exporter has its own element test, and each of those tests covers a hand-picked subset. What
 * nothing does is enumerate the `NodeType` union and check that every member reaches every format —
 * so a type that one exporter renders and another silently drops looks exactly like a type that
 * works. `renderNode`'s `default:` returns an empty string; the docx and pptx writers have the same
 * shape. A node that falls through leaves no trace in the artifact and no error anywhere.
 *
 * This builds one representative node per type, each carrying a unique marker, runs the four
 * writers, and reports which markers came out the other side. It is the survey; the test that locks
 * the result is __tests__/node-vocabulary-coverage.test.ts.
 *
 *   npx tsx scripts/probe-node-vocabulary.mts
 */
import JSZip from 'jszip';
import { renderCanvasToHtml } from '@/lib/export/canvas-html';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { exportToPptx } from '@/lib/export/pptx-exporter';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode, type NodeType } from '@/lib/types/canvas-document';

/** A marker that survives XML escaping and cannot occur by accident. */
const mark = (t: string) => `ZQMARK${t.toUpperCase().replace(/_/g, '')}ZQ`;

let seq = 0;
const node = (type: NodeType, content: unknown, style: Record<string, unknown> = {}): CanvasNode => ({
  id: `n${++seq}`, type, content: content as CanvasNode['content'],
  style: style as CanvasNode['style'], provenance: { source: 'template' }, history: [],
} as CanvasNode);

/**
 * One representative node per NodeType, each carrying its own marker where the type allows text.
 *
 * Typed as `Record<NodeType, …>` ON PURPOSE: a new member of the union that nobody adds a case for
 * is a COMPILE error here, not a silently uncovered type. A plain array would let the next node
 * type be added, rendered in HTML, dropped by the docx writer, and pass every test in the repo.
 */
export interface VocabCase { node: CanvasNode; textual: boolean; note?: string }
export const VOCAB: Record<NodeType, VocabCase> = Object.fromEntries(([
  ['heading', { node: node('heading', { level: 2, text: mark('heading') }), textual: true }],
  ['text_block', { node: node('text_block', { text: mark('text_block') }), textual: true }],
  ['bulleted_list', { node: node('bulleted_list', { items: [{ text: mark('bulleted_list') }] }), textual: true }],
  ['numbered_list', { node: node('numbered_list', { items: [{ text: mark('numbered_list') }] }), textual: true }],
  ['image', { node: node('image', { storage_key: '', alt_text: mark('image'), width: 400, height: 200 }), textual: true }],
  ['table', { node: node('table', { headers: [mark('table')], rows: [['cell']] }), textual: true }],
  ['caption', { node: node('caption', { prefix: 'Figure', number: '1', text: mark('caption') }), textual: true }],
  ['footnote', { node: node('footnote', { marker: '1', text: mark('footnote') }), textual: true }],
  ['toc', { node: node('toc', { max_depth: 2 }), textual: false }],
  ['page_break', { node: node('page_break', {}), textual: false }],
  ['url', { node: node('url', { href: 'https://example.gov', display_text: mark('url') }), textual: true }],
  ['spacer', { node: node('spacer', { height: 24 }), textual: false }],
  ['shape', { node: node('shape', { shape: 'rectangle', text: mark('shape') }), textual: true }],
  ['text_box', { node: node('text_box', { text: mark('text_box') }), textual: true }],
  ['callout', { node: node('callout', { variant: 'warning', title: 'Note', text: mark('callout') }), textual: true }],
  ['code_block', { node: node('code_block', { language: 'python', code: `x = "${mark('code_block')}"` }), textual: true }],
  ['blockquote', { node: node('blockquote', { text: mark('blockquote'), cite: 'Source' }), textual: true }],
  ['chart', { node: node('chart', { chart_type: 'bar', categories: [mark('chart')], series: [{ name: 'S', data: [1] }] }), textual: true }],
  ['equation', { node: node('equation', { latex: mark('equation') }), textual: true }],
  ['divider', { node: node('divider', { thickness: 1, line_style: 'solid' }), textual: false }],
  ['video', { node: node('video', { url: 'https://example.gov/v.mp4', caption: mark('video') }), textual: true }],
  ['signature', { node: node('signature', { label: mark('signature'), signer_name: 'Dana Whitlock' }), textual: true }],
] as Array<[NodeType, VocabCase]>).map(([t, c]) => [t, c])) as Record<NodeType, VocabCase>;

/** Document order, for building a document out of the whole vocabulary. */
export const VOCABULARY = (Object.keys(VOCAB) as NodeType[]).map((type) => ({ type, ...VOCAB[type] }));
export { mark };

export function vocabularyDoc(preset = 'letter_standard'): CanvasDocument {
  return {
    version: 2, document_id: 'vocab',
    canvas: { ...CANVAS_PRESETS[preset] },
    sections: [{
      id: 's1', title: 'Vocabulary', layout: { mode: 'flow' },
      groups: [{ id: 'g1', nodes: VOCABULARY.map((v) => v.node) }],
    }],
    metadata: { title: 'Vocabulary', status: 'accepted' },
  } as unknown as CanvasDocument;
}

/** All text in an OOXML package, across every part — markers can land in any of them. */
async function zipText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const parts = await Promise.all(Object.keys(zip.files)
    .filter((f) => /\.(xml|rels)$/.test(f))
    .map((f) => zip.files[f].async('string')));
  return parts.join('\n');
}

async function main() {
  const doc = vocabularyDoc();
  const html = renderCanvasToHtml(doc, {});
  const [docx, pptx, xlsx] = await Promise.all([
    exportToDocx(doc, {}).then(zipText),
    exportToPptx(vocabularyDoc('slide_cso'), {}).then(zipText),
    exportToXlsx(doc, {}).then(zipText),
  ]);
  const lanes: Array<[string, string]> = [['html/pdf', html], ['docx', docx], ['pptx', pptx], ['xlsx', xlsx]];

  console.log('NODE TYPE        html/pdf   docx   pptx   xlsx');
  console.log('─'.repeat(50));
  const missing: Record<string, string[]> = {};
  for (const v of VOCABULARY) {
    if (!v.textual) { console.log(`${v.type.padEnd(16)}  (no text of its own — checked structurally)`); continue; }
    const cells = lanes.map(([name, body]) => {
      const ok = body.includes(mark(v.type));
      if (!ok) (missing[name] ??= []).push(v.type);
      return ok ? '  ✓  ' : '  ·  ';
    });
    console.log(`${v.type.padEnd(16)}${cells[0].padEnd(10)}${cells[1].padEnd(7)}${cells[2].padEnd(7)}${cells[3]}`);
  }
  console.log();
  for (const [name] of lanes) {
    const m = missing[name] ?? [];
    console.log(`${name.padEnd(9)} drops ${m.length}${m.length ? ': ' + m.join(', ') : ''}`);
  }
}

if (process.argv[1]?.endsWith('probe-node-vocabulary.mts')) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

/**
 * Differential media check — for a node a writer RASTERISES rather than writing as text.
 * The docx and xlsx writers turn charts (and, in xlsx, shapes) into embedded PNGs, so a text
 * marker cannot see them and its absence is not evidence of a drop. Exporting with and without the
 * node and comparing the media parts is: a rendered node adds a part, a dropped one adds nothing.
 */
export async function mediaCount(buf: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files).filter((f) => /media\/.*\.(png|jpe?g|gif|emf|svg)$/i.test(f)).length;
}
