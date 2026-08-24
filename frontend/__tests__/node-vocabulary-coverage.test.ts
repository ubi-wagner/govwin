/**
 * EVERY node type must come out of EVERY exporter — as text, or as a raster it deliberately became.
 *
 * There is a per-exporter element test for docx, pptx, xlsx and the HTML/PDF substrate, and each
 * covers a hand-picked subset of node types. None of them enumerates the `NodeType` union, so a
 * type one writer renders and another drops looks exactly like a type that works: `renderNode`'s
 * `default:` returns an empty string, and the docx and pptx writers have the same shape. A node
 * that falls through leaves no trace in the artifact and no error anywhere — the customer just
 * gets a submission with a section missing from one of the four formats they can download.
 *
 * The survey behind this file is `scripts/probe-node-vocabulary.mts`. It found all 22 types
 * present in all four lanes: 21 of them textually in docx (a rectangle shape becomes a bordered
 * table with its text intact), and `chart` in docx plus `chart`/`shape` in xlsx as embedded PNGs —
 * rasterised, which is rendering, not dropping. The differential media check is what separates
 * those two: a rendered node adds a media part, a dropped one adds nothing.
 *
 * `VOCAB` is typed `Record<NodeType, …>`, so adding a member to the union without adding a case
 * here is a compile error rather than an uncovered type.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { renderCanvasToHtml } from '@/lib/export/canvas-html';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { exportToPptx } from '@/lib/export/pptx-exporter';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode, type NodeType } from '@/lib/types/canvas-document';
import { VOCAB, VOCABULARY, mark, vocabularyDoc } from '@/scripts/probe-node-vocabulary.mts';

/** Text across every XML part of an OOXML package — a marker can land in any of them. */
async function zipText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const parts = await Promise.all(Object.keys(zip.files)
    .filter((f) => /\.(xml|rels)$/.test(f))
    .map((f) => zip.files[f].async('string')));
  return parts.join('\n');
}
async function mediaCount(buf: Buffer): Promise<number> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files).filter((f) => /media\/.*\.(png|jpe?g|gif|emf|svg)$/i.test(f)).length;
}

const docOf = (nodes: CanvasNode[], preset = 'letter_standard'): CanvasDocument => ({
  version: 2, document_id: 'v', canvas: { ...CANVAS_PRESETS[preset] },
  sections: [{ id: 's', title: 'S', layout: { mode: 'flow' }, groups: [{ id: 'g', nodes }] }],
  metadata: { title: 'V', status: 'accepted' },
} as unknown as CanvasDocument);

/**
 * Types a writer RASTERISES instead of writing as text. Each entry is a decision someone made,
 * recorded here so the test can check the right thing — never a way to excuse a type that vanished.
 * A type listed here must still ADD A MEDIA PART, which a dropped node cannot do.
 */
const RASTERISED: Record<'docx' | 'pptx' | 'xlsx', NodeType[]> = {
  docx: ['chart'],
  pptx: [],
  xlsx: ['chart', 'shape'],
};

describe('node vocabulary — every type survives every exporter', () => {
  it('covers the whole NodeType union', () => {
    // The Record type makes this a compile-time guarantee; this asserts the count out loud so a
    // reader knows what "the whole union" is worth today.
    expect(VOCABULARY).toHaveLength(22);
    expect(new Set(VOCABULARY.map((v) => v.type)).size).toBe(VOCABULARY.length);
  });

  it('HTML/PDF renders every textual type', () => {
    const html = renderCanvasToHtml(vocabularyDoc(), {});
    const missing = VOCABULARY.filter((v) => v.textual && !html.includes(mark(v.type))).map((v) => v.type);
    expect(missing).toEqual([]);
  });

  it('docx renders every textual type, and rasterises the rest', async () => {
    const buf = await exportToDocx(vocabularyDoc(), {});
    const xml = await zipText(buf);
    const missing = VOCABULARY
      .filter((v) => v.textual && !RASTERISED.docx.includes(v.type) && !xml.includes(mark(v.type)))
      .map((v) => v.type);
    expect(missing).toEqual([]);
  }, 60_000);

  it('pptx renders every textual type', async () => {
    const xml = await zipText(await exportToPptx(vocabularyDoc('slide_cso'), {}));
    const missing = VOCABULARY
      .filter((v) => v.textual && !RASTERISED.pptx.includes(v.type) && !xml.includes(mark(v.type)))
      .map((v) => v.type);
    expect(missing).toEqual([]);
  }, 60_000);

  it('xlsx renders every textual type, and rasterises the rest', async () => {
    const xml = await zipText(await exportToXlsx(vocabularyDoc(), {}));
    const missing = VOCABULARY
      .filter((v) => v.textual && !RASTERISED.xlsx.includes(v.type) && !xml.includes(mark(v.type)))
      .map((v) => v.type);
    expect(missing).toEqual([]);
  }, 60_000);

  it('a rasterised type really does become a picture, rather than disappearing', async () => {
    // The distinction the text probe cannot make. Export with and without the node and compare the
    // media parts: rendering adds one, dropping adds nothing. Without this, listing a type in
    // RASTERISED would be indistinguishable from excusing it.
    const filler = VOCAB.text_block.node;
    for (const [lane, exporter] of [['docx', exportToDocx], ['xlsx', exportToXlsx]] as const) {
      for (const type of RASTERISED[lane]) {
        const without = await mediaCount(await exporter(docOf([filler]), {}));
        const withNode = await mediaCount(await exporter(docOf([filler, VOCAB[type].node]), {}));
        expect(withNode, `${lane} / ${type} should add a media part`).toBeGreaterThan(without);
      }
    }
  }, 120_000);

  it('a type with no text of its own still reaches the page structurally', () => {
    // toc, page_break, spacer and divider carry no words, so a marker cannot find them. Each is
    // checked by what it DOES to the document instead.
    const html = (nodes: CanvasNode[]) => renderCanvasToHtml(docOf(nodes), {});
    expect(html([VOCAB.divider.node])).toMatch(/<hr[\s>]/);
    expect(html([VOCAB.page_break.node])).toMatch(/page-break-after\s*:\s*always/);
    expect(html([VOCAB.spacer.node])).toMatch(/height\s*:\s*\d+pt/);
    // A toc renders the document's own headings, so it needs one to show.
    expect(html([VOCAB.toc.node, VOCAB.heading.node])).toContain(mark('heading'));
  });
});

/**
 * A spacer's height has ONE answer, and every reader gives it (B109).
 *
 * There were five readers and four different heights, none of them the author's: the ruler read
 * `content.height`; canvas-html read `style.space_after` and fell back to a hardcoded 12pt, so
 * `content.height = 600` rendered as 12; docx hardcoded 200 twips; pptx hardcoded 0.3in; the editor
 * hardcoded `h-8`. Nothing was lost — it is whitespace — but the page RULER measured a height no
 * writer would produce, which is the B64/B65 divergence in miniature: the gauge and the artifact
 * disagreeing about the same node.
 */
describe('spacer height is one number, honoured by every reader (B109)', () => {
  const spacerDoc = (content: unknown, style: unknown = {}): CanvasDocument => ({
    version: 2, document_id: 'sp', canvas: { ...CANVAS_PRESETS.letter_standard }, nodes: [],
    sections: [{ id: 's', title: 'sp', layout: { mode: 'flow' }, groups: [{ id: 'g', nodes: [{
      id: 'n1', type: 'spacer', content, style,
      provenance: { source: 'manual' }, history: [], library_eligible: false,
    } as unknown as CanvasNode] }] }],
    metadata: { title: 'sp', status: 'in_progress' },
  } as unknown as CanvasDocument);

  it('renders the height the author set in content.height', () => {
    expect(renderCanvasToHtml(spacerDoc({ height: 600 }), {})).toContain('height:600pt');
  });

  it('still honours style.space_after, which stored documents may carry', () => {
    expect(renderCanvasToHtml(spacerDoc({}, { space_after: 480 }), {})).toContain('height:480pt');
  });

  it('prefers content.height when both are present — it is the spacer-specific field', () => {
    expect(renderCanvasToHtml(spacerDoc({ height: 300 }, { space_after: 99 }), {})).toContain('height:300pt');
  });

  it('falls back to a sane default when the author set neither', () => {
    expect(renderCanvasToHtml(spacerDoc({}), {})).toContain('height:12pt');
  });

  it('the RULER and the rendered page agree — a tall spacer pushes both to a second page', async () => {
    const { estimatePageCount } = await import('@/lib/types/canvas-document');
    expect(estimatePageCount(spacerDoc({ height: 900 }))).toBeGreaterThan(1);
    expect(renderCanvasToHtml(spacerDoc({ height: 900 }), {})).toContain('height:900pt');
  });

  it('docx scales the author height into twips rather than hardcoding 200', async () => {
    const [small, large] = await Promise.all([
      exportToDocx(spacerDoc({ height: 12 }), {}).then(zipText),
      exportToDocx(spacerDoc({ height: 600 }), {}).then(zipText),
    ]);
    expect(small).toContain('w:after="240"');    // 12pt × 20
    expect(large).toContain('w:after="12000"');  // 600pt × 20
  });
});
