import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { exportToPptx } from '@/lib/export/pptx-exporter';
import { CANVAS_PRESETS, type CanvasNode, type CanvasDocument } from '@/lib/types/canvas-document';

// Proves the pptx exporter RENDERS every extended element into the real .pptx
// bytes — shapes/textboxes/callouts as DrawingML shapes, charts as NATIVE
// embedded chart parts — by unzipping the OpenXML package and inspecting the
// slide + chart XML. No mock: exportToPptx runs pptxgenjs end-to-end.
function node(type: CanvasNode['type'], content: unknown, style: Record<string, unknown> = {}, position?: unknown): CanvasNode {
  return {
    id: crypto.randomUUID(), type, content: content as CanvasNode['content'],
    style: style as CanvasNode['style'], provenance: { source: 'template' }, history: [],
    library_eligible: true, ...(position ? { position: position as CanvasNode['position'] } : {}),
  };
}
function docOf(nodes: CanvasNode[]): CanvasDocument {
  return {
    version: 2, document_id: 'd', canvas: CANVAS_PRESETS.slide_cso, nodes: [],
    sections: [{ id: 's', title: 'S', layout: { mode: 'flow' }, groups: [{ id: 'g', nodes }] }],
    metadata: { title: 'Elements Deck', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted' },
  } as CanvasDocument;
}

const ALL: CanvasNode[] = [
  node('heading', { level: 2, text: 'Extended Elements' }),
  node('shape', { shape: 'ellipse', text: 'Orbit' }, { fill: { color: '#EEEEEE', opacity: 0.5 }, border: { color: '#333333', width: 2, style: 'dashed' }, rotation: 5 }),
  node('shape', { shape: 'rounded_rectangle' }, { fill: { color: '#DCE6F1' } }, { x: 6, y: 1, w: 2, h: 1, wrap: 'front' }),
  node('text_box', { text: 'Floating box does not snap to margins' }, { border: { color: '#000000', width: 1 } }, { x: 1, y: 4, w: 3, h: 1, wrap: 'float' }),
  node('callout', { variant: 'warning', title: 'Heads up', text: 'Callout body text' }),
  node('code_block', { code: 'const x = deploy(config);', language: 'ts' }),
  node('blockquote', { text: 'A quote worth pulling out', cite: 'Program Office' }),
  node('chart', { chart_type: 'bar', title: 'Growth', categories: ['A', 'B', 'C'], series: [{ name: 'Rev', data: [3, 7, 5] }] }),
  node('chart', { chart_type: 'pie', categories: ['X', 'Y'], series: [{ name: 'Split', data: [1, 3] }] }),
  node('equation', { latex: 'E=mc^2', display: true }),
  node('divider', { thickness: 2, line_style: 'dashed', color: '#CBD5E1' }),
  node('video', { url: 'https://example.com/v.mp4', caption: 'Demo clip' }),
  node('signature', { label: 'Authorized Representative', signer_name: 'Jane Doe', signed: true, signed_at: '2026-07-24' }),
];

describe('pptx exporter: extended elements → real OpenXML', () => {
  it('emits a valid .pptx zip with slide + native chart parts', async () => {
    const buf = await exportToPptx(docOf(ALL), {});
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(2000);
    expect(buf.slice(0, 2).toString('latin1')).toBe('PK'); // zip magic

    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    expect(names).toContain('[Content_Types].xml');

    // slide XML — DrawingML shapes for the vector elements
    const slidePath = names.find((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
    expect(slidePath).toBeTruthy();
    const slide = await zip.file(slidePath!)!.async('string');
    expect(slide).toContain('prst="ellipse"');   // shape
    expect(slide).toContain('prst="roundRect"');  // rounded shape + callout box
    expect(slide).toContain('prst="line"');       // divider + signature rule
    expect(slide).toContain('const x = deploy(config);'); // code_block text
    expect(slide).toContain('Heads up');          // callout title
    expect(slide).toContain('A quote worth pulling out'); // blockquote
    expect(slide).toContain('E=mc^2');            // equation
    expect(slide).toContain('Authorized Representative'); // signature label
    expect(slide).toContain('Jane Doe');          // signed name
    expect(slide).toMatch(/graphicFrame/);        // the charts are graphic frames

    // native charts: two embedded chart parts, one bar + one pie
    const chartParts = names.filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    expect(chartParts.length).toBe(2);
    const chartXml = (await Promise.all(chartParts.map((p) => zip.file(p)!.async('string')))).join('\n');
    expect(chartXml).toContain('<c:barChart>');
    expect(chartXml).toContain('<c:pieChart>');
  });

  it('a chart-only deck still produces a valid embedded chart', async () => {
    const buf = await exportToPptx(docOf([
      node('heading', { level: 2, text: 'Just a chart' }),
      node('chart', { chart_type: 'line', categories: ['Q1', 'Q2', 'Q3'], series: [{ name: 'A', data: [1, 2, 3], color: '#FF0000' }, { name: 'B', data: [3, 2, 1] }] }),
    ]), {});
    const zip = await JSZip.loadAsync(buf);
    const chartParts = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n));
    expect(chartParts.length).toBe(1);
    const xml = await zip.file(chartParts[0])!.async('string');
    expect(xml).toContain('<c:lineChart>');
    expect(xml).toContain('FF0000'); // series color honored
  });
});
