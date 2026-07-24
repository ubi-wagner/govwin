import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import { CANVAS_PRESETS, type CanvasNode, type CanvasDocument } from '@/lib/types/canvas-document';

// Proves the xlsx exporter RENDERS every extended element: charts/shapes/images
// as embedded PNG pictures (xl/media), and the text-y elements as styled cells
// (fill/border/font). exportToXlsx runs exceljs end-to-end — no mock.
function node(type: CanvasNode['type'], content: unknown, style: Record<string, unknown> = {}): CanvasNode {
  return {
    id: crypto.randomUUID(), type, content: content as CanvasNode['content'],
    style: style as CanvasNode['style'], provenance: { source: 'template' }, history: [], library_eligible: true,
  };
}
function docOf(nodes: CanvasNode[]): CanvasDocument {
  return {
    version: 2, document_id: 'd', canvas: CANVAS_PRESETS.spreadsheet, nodes: [],
    sections: [{ id: 's', title: 'S', layout: { mode: 'flow' }, groups: [{ id: 'g', nodes }] }],
    metadata: { title: 'Elements Sheet', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted' },
  } as CanvasDocument;
}

const TINY_SVG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="60"><rect width="80" height="60" fill="#39c"/></svg>');

const ALL: CanvasNode[] = [
  node('heading', { level: 2, text: 'Extended Elements' }),
  node('callout', { variant: 'warning', title: 'Heads up', text: 'Callout body text' }),
  node('code_block', { code: 'const x = deploy(config);\nreturn x;', language: 'ts' }),
  node('blockquote', { text: 'A quote worth pulling out', cite: 'Program Office' }),
  node('text_box', { text: 'Floating content box' }, { fill: { color: '#DCE6F1' }, border: { color: '#000000', width: 1 } }),
  node('equation', { latex: 'E=mc^2', display: true }),
  node('divider', { thickness: 2, line_style: 'dashed', color: '#CBD5E1' }),
  node('video', { url: 'https://example.com/v.mp4', caption: 'Demo clip' }),
  node('signature', { label: 'Authorized Representative', signer_name: 'Jane Doe', signed: true, signed_at: '2026-07-24' }),
  node('shape', { shape: 'ellipse', text: 'Orbit' }, { fill: { color: '#EEEEEE' }, border: { color: '#333333', width: 2 } }),
  node('chart', { chart_type: 'bar', title: 'Growth', categories: ['A', 'B', 'C'], series: [{ name: 'Rev', data: [3, 7, 5] }] }),
  node('chart', { chart_type: 'pie', categories: ['X', 'Y'], series: [{ name: 'Split', data: [1, 3] }] }),
  node('image', { storage_key: TINY_SVG, alt_text: 'logo', width: 80, height: 60 }),
];

async function contentText(buf: Buffer): Promise<{ text: string; wb: ExcelJS.Workbook }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Content')!;
  const parts: string[] = [];
  ws.eachRow((row) => row.eachCell((cell) => parts.push(String(cell.text ?? ''))));
  return { text: parts.join('\n'), wb };
}

describe('xlsx exporter: extended elements → real workbook', () => {
  it('writes styled cells + embeds chart/shape/image pictures', async () => {
    const buf = await exportToXlsx(docOf(ALL), {});
    expect(buf.slice(0, 2).toString('latin1')).toBe('PK');

    const { text, wb } = await contentText(buf);
    expect(text).toContain('Heads up');                  // callout title
    expect(text).toContain('const x = deploy(config);'); // code line 1
    expect(text).toContain('A quote worth pulling out'); // blockquote
    expect(text).toContain('Program Office');            // citation
    expect(text).toContain('Floating content box');      // text_box
    expect(text).toContain('E=mc^2');                    // equation
    expect(text).toContain('Jane Doe');                  // signature name
    expect(text).toContain('Authorized Representative');  // signature label
    expect(text).toContain('Demo clip');                 // video label

    // callout fill (warning bg) is a real cell fill
    const ws = wb.getWorksheet('Content')!;
    let calloutFill: string | undefined;
    let videoLink: string | undefined;
    ws.eachRow((row) => row.eachCell((cell) => {
      if (String(cell.text).includes('Heads up')) {
        const fill = cell.fill as ExcelJS.FillPattern;
        calloutFill = fill?.fgColor?.argb;
      }
      const v = cell.value as ExcelJS.CellHyperlinkValue;
      if (v && typeof v === 'object' && 'hyperlink' in v) videoLink = v.hyperlink;
    }));
    expect(calloutFill).toBe('FFFEF3C7');
    expect(videoLink).toBe('https://example.com/v.mp4');

    // charts (bar+pie) + shape (ellipse) + image ⇒ ≥4 embedded pictures
    const zip = await JSZip.loadAsync(buf);
    const media = Object.keys(zip.files).filter((n) => /^xl\/media\/.+\.(png|jpe?g)$/.test(n));
    expect(media.length).toBeGreaterThanOrEqual(4);
  });

  it('a chart-only sheet embeds exactly one picture', async () => {
    const buf = await exportToXlsx(docOf([
      node('heading', { level: 2, text: 'Chart only' }),
      node('chart', { chart_type: 'line', categories: ['Q1', 'Q2'], series: [{ name: 'A', data: [1, 2] }] }),
    ]), {});
    const zip = await JSZip.loadAsync(buf);
    const media = Object.keys(zip.files).filter((n) => /^xl\/media\/.+\.png$/.test(n));
    expect(media.length).toBe(1);
  });
});
