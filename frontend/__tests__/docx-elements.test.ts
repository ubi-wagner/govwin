import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { CANVAS_PRESETS, type CanvasNode, type CanvasDocument } from '@/lib/types/canvas-document';

// Proves the docx exporter RENDERS every extended element into the real .docx
// bytes: box-like elements (rect shape / text_box / callout / code / video) as
// native shaded+bordered tables, vector shapes + charts as embedded PNG figures
// (word/media), and the paragraph-native elements (blockquote/equation/divider/
// signature). exportToDocx runs the `docx` packer end-to-end — no mock.
function node(type: CanvasNode['type'], content: unknown, style: Record<string, unknown> = {}, position?: unknown): CanvasNode {
  return {
    id: crypto.randomUUID(), type, content: content as CanvasNode['content'],
    style: style as CanvasNode['style'], provenance: { source: 'template' }, history: [],
    library_eligible: true, ...(position ? { position: position as CanvasNode['position'] } : {}),
  };
}
function docOf(nodes: CanvasNode[]): CanvasDocument {
  return {
    version: 2, document_id: 'd', canvas: CANVAS_PRESETS.letter_standard, nodes: [],
    sections: [{ id: 's', title: 'S', layout: { mode: 'flow' }, groups: [{ id: 'g', nodes }] }],
    metadata: { title: 'Elements Doc', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted' },
  } as CanvasDocument;
}

const ALL: CanvasNode[] = [
  node('heading', { level: 2, text: 'Extended Elements' }),
  node('shape', { shape: 'rectangle', text: 'Boxed label' }, { fill: { color: '#DCE6F1' }, border: { color: '#1F4E79', width: 1, style: 'solid' } }),
  node('shape', { shape: 'ellipse', text: 'Orbit' }, { fill: { color: '#EEEEEE', opacity: 0.6 }, border: { color: '#333333', width: 2 } }),
  node('shape', { shape: 'arrow' }, { fill: { color: '#2E75B6' } }),
  node('text_box', { text: 'Floating content box' }, { border: { color: '#000000', width: 1 } }),
  node('callout', { variant: 'warning', title: 'Heads up', text: 'Callout body text' }),
  node('code_block', { code: 'const x = deploy(config);\nreturn x;', language: 'ts' }),
  node('blockquote', { text: 'A quote worth pulling out', cite: 'Program Office' }),
  node('chart', { chart_type: 'bar', title: 'Growth', categories: ['A', 'B', 'C'], series: [{ name: 'Rev', data: [3, 7, 5] }] }),
  node('chart', { chart_type: 'pie', categories: ['X', 'Y'], series: [{ name: 'Split', data: [1, 3] }] }),
  node('equation', { latex: 'E=mc^2', display: true }),
  node('divider', { thickness: 2, line_style: 'dashed', color: '#CBD5E1' }),
  node('video', { url: 'https://example.com/v.mp4', caption: 'Demo clip' }),
  node('signature', { label: 'Authorized Representative', signer_name: 'Jane Doe', signed: true, signed_at: '2026-07-24' }),
];

describe('docx exporter: extended elements → real OpenXML', () => {
  it('emits a valid .docx with native boxes + embedded raster figures', async () => {
    const buf = await exportToDocx(docOf(ALL), {});
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.slice(0, 2).toString('latin1')).toBe('PK');

    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    const xml = await zip.file('word/document.xml')!.async('string');

    // native box + paragraph text content
    expect(xml).toContain('Boxed label');                 // rectangle shape (native box text)
    expect(xml).toContain('Floating content box');        // text_box
    expect(xml).toContain('Heads up');                    // callout title
    expect(xml).toContain('const x = deploy(config);');   // code_block line 1
    expect(xml).toContain('A quote worth pulling out');   // blockquote
    expect(xml).toContain('Program Office');              // citation
    expect(xml).toContain('E=mc^2');                      // equation
    expect(xml).toContain('Authorized Representative');   // signature label
    expect(xml).toContain('Jane Doe');                    // signed name
    expect(xml).toContain('Demo clip');                   // video label

    // box fill (callout warning bg) + dashed divider border are real OOXML attrs
    expect(xml).toContain('FEF3C7');                      // callout fill shading
    expect(xml).toContain('w:val="dashed"');             // dashed divider border

    // vector shapes + charts embed as PNG pictures (ellipse, arrow, bar, pie ⇒ ≥4).
    // docx names embedded media by content-hash (word/media/<sha>.png), not imageN.
    const media = names.filter((n) => /^word\/media\/.+\.(png|jpe?g)$/.test(n));
    expect(media.length).toBeGreaterThanOrEqual(4);
    expect(xml).toContain('<w:drawing>');                 // the pictures are anchored drawings
  });

  it('a rounded_rectangle shape renders as a native box (not an image)', async () => {
    const buf = await exportToDocx(docOf([
      node('shape', { shape: 'rounded_rectangle', text: 'Rounded' }, { fill: { color: '#ECFDF5' } }),
    ]), {});
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Rounded');
    expect(xml).toContain('ECFDF5');
    expect(names.filter((n) => /^word\/media\//.test(n)).length).toBe(0); // box shape, no raster
  });
});
