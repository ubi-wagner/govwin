import { describe, it, expect } from 'vitest';
import { renderShapeSvg } from '@/lib/export/canvas-html';
import type { CanvasNode } from '@/lib/types/canvas-document';

// renderShapeSvg is the shape substrate the editor injects for its live preview
// AND the docx/xlsx exporters rasterize — so what you see is what you export.
function shapeNode(shape: string, style: Record<string, unknown> = {}, text?: string): CanvasNode {
  return {
    id: 's', type: 'shape', content: { shape, ...(text ? { text } : {}) } as CanvasNode['content'],
    style: style as CanvasNode['style'], provenance: { source: 'template' }, history: [], library_eligible: true,
  };
}

describe('renderShapeSvg', () => {
  it('draws an ellipse with fill(+opacity as rgba), border, rotation, and its text', () => {
    const svg = renderShapeSvg(shapeNode('ellipse',
      { fill: { color: '#EEEEEE', opacity: 0.5 }, border: { color: '#333333', width: 2, style: 'dashed' }, rotation: 15 }, 'Orbit'));
    expect(svg).toContain('data-shape="ellipse"');
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('rgba(238,238,238,0.5)');       // fill opacity
    expect(svg).toContain('stroke="#333333"');
    expect(svg).toContain('stroke-dasharray');            // dashed border
    expect(svg).toContain('rotate(15');                   // rotation
    expect(svg).toContain('>Orbit<');                     // shape text
  });

  it('maps each ShapeKind to the right SVG primitive', () => {
    expect(renderShapeSvg(shapeNode('rectangle'))).toContain('<rect');
    expect(renderShapeSvg(shapeNode('rounded_rectangle'))).toMatch(/<rect[^>]*rx=/);
    expect(renderShapeSvg(shapeNode('triangle'))).toContain('<polygon');
    expect(renderShapeSvg(shapeNode('diamond'))).toContain('<polygon');
    expect(renderShapeSvg(shapeNode('star'))).toContain('<polygon');
    expect(renderShapeSvg(shapeNode('line'))).toContain('<line');
    expect(renderShapeSvg(shapeNode('arrow'))).toContain('<path');
    expect(renderShapeSvg(shapeNode('callout_bubble'))).toContain('<path');
  });

  it('is a standalone, namespaced SVG (embeddable + rasterizable)', () => {
    const svg = renderShapeSvg(shapeNode('rectangle', { fill: { color: '#DCE6F1' } }));
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain('fill="#DCE6F1"');
  });
});
