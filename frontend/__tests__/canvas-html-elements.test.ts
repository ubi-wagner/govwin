import { describe, it, expect } from 'vitest';
import { renderCanvasToHtml } from '@/lib/export/canvas-html';
import { CANVAS_PRESETS, type CanvasNode, type CanvasDocument } from '@/lib/types/canvas-document';

// The PDF/HTML substrate renders every extended element type + the full box/run
// style set. Pure function — proves the capability without Chromium.
function node(type: CanvasNode['type'], content: unknown, style: Record<string, unknown> = {}, position?: unknown): CanvasNode {
  return {
    id: crypto.randomUUID(), type, content: content as CanvasNode['content'],
    style: style as CanvasNode['style'], provenance: { source: 'template' }, history: [],
    library_eligible: true, ...(position ? { position: position as CanvasNode['position'] } : {}),
  };
}
function docOf(nodes: CanvasNode[]): CanvasDocument {
  return {
    version: 2, document_id: 'd', canvas: CANVAS_PRESETS.custom, nodes: [],
    sections: [{ id: 's', title: 'S', layout: { mode: 'flow' }, groups: [{ id: 'g', nodes }] }],
    metadata: { title: 'T', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted' },
  } as CanvasDocument;
}
const html = (nodes: CanvasNode[]) => renderCanvasToHtml(docOf(nodes), {});

describe('canvas-html extended elements', () => {
  it('renders full run styling (bold/italic/underline/strike/highlight/color/align)', () => {
    const h = html([node('text_block', { text: 'x' }, {
      weight: 'bold', style: 'italic', underline: true, strikethrough: true, highlight: '#FFFF00', color: '#FF0000', alignment: 'center',
    })]);
    expect(h).toContain('font-weight:bold');
    expect(h).toContain('font-style:italic');
    expect(h).toContain('text-decoration:underline line-through');
    expect(h).toContain('background-color:#FFFF00');
    expect(h).toContain('color:#FF0000');
    expect(h).toContain('text-align:center');
  });

  it('renders a shape with fill(+opacity)/border/radius/opacity/rotation/free-position', () => {
    const h = html([node('shape', { shape: 'rectangle', text: 'Box' },
      { fill: { color: '#EEEEEE', opacity: 0.5 }, border: { color: '#333333', width: 2, style: 'dashed', radius: 6 }, opacity: 0.9, rotation: 5 },
      { x: 1, y: 2, w: 3, h: 1, wrap: 'front' })]);
    expect(h).toContain('data-shape="rectangle"');
    expect(h).toContain('background-color:rgba(238,238,238,0.5)');
    expect(h).toContain('border:2pt dashed');
    expect(h).toContain('border-radius:6pt');
    expect(h).toContain('opacity:0.9');
    expect(h).toContain('transform:rotate(5deg)');
    expect(h).toContain('position:absolute');
    expect(h).toContain('left:1in');
    expect(h).toContain('top:2in');
  });

  it('renders an ellipse as a circle', () => {
    expect(html([node('shape', { shape: 'ellipse' })])).toContain('border-radius:50%');
  });

  it('renders callout / code_block / blockquote / divider / signature', () => {
    expect(html([node('callout', { variant: 'warning', text: 'w' })])).toContain('data-callout="warning"');
    expect(html([node('code_block', { code: 'x=1' })])).toContain('<pre');
    expect(html([node('blockquote', { text: 'q' })])).toContain('<blockquote');
    expect(html([node('divider', { thickness: 2, line_style: 'dashed' })])).toContain('<hr');
    expect(html([node('signature', { label: 'Rep' })])).toContain('data-signature');
  });

  it('renders an equation with its latex', () => {
    expect(html([node('equation', { latex: 'x^2' })])).toContain('data-latex="x^2"');
  });

  it('renders a bar chart as inline SVG with bars', () => {
    const h = html([node('chart', { chart_type: 'bar', categories: ['A', 'B'], series: [{ name: 'S', data: [3, 7] }] })]);
    expect(h).toContain('<svg');
    expect(h).toContain('data-chart="bar"');
    expect(h).toContain('<rect');
  });

  it('renders a pie chart as SVG paths', () => {
    const h = html([node('chart', { chart_type: 'pie', categories: ['A', 'B'], series: [{ name: 'S', data: [1, 3] }] })]);
    expect(h).toContain('data-chart="pie"');
    expect(h).toContain('<path');
  });

  it('a floating text_box gets absolute positioning (does not snap to margins)', () => {
    const h = html([node('text_box', { text: 'float' }, { border: { color: '#000', width: 1 } }, { x: 2, y: 3, w: 2, h: 1, wrap: 'float' })]);
    expect(h).toContain('position:absolute');
    expect(h).toContain('left:2in');
  });
});
