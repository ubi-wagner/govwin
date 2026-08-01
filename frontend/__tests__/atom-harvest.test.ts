import { describe, it, expect } from 'vitest';
import { harvestTextOfNodes } from '@/lib/atom-size';
import type { CanvasNode } from '@/lib/types/canvas-document';

// Regression for the lock-time atom harvest: harvested section atoms must NOT bake in the
// section-title heading, and tables must render WITH their header row (not collapse to a
// headerless "✓ ✗ ✓" stream). See lib/proposal-atom-harvest.ts::harvestTextOfNodes.
const node = (type: string, content: unknown): CanvasNode =>
  ({ id: 'n', type, style: {}, content } as unknown as CanvasNode);

describe('harvestTextOfNodes (atom-harvest quality)', () => {
  const nodes: CanvasNode[] = [
    node('heading', { level: 1, text: '#9  Competitive Landscape' }),
    node('text_block', { text: 'Foundation wins on the dimensions that decide adoption:' }),
    node('table', {
      headers: ['Dimension', 'Foundation', 'Traditional'],
      rows: [
        ['Time (days)', '✓', '✗'],
        [{ text: 'Project costs' }, { text: '✓' }, { text: '✗' }],
      ],
    }),
  ];
  const out = harvestTextOfNodes(nodes, '#9 Competitive Landscape');

  it('drops the redundant section-title heading', () => {
    expect(out).not.toMatch(/Competitive Landscape/);
    expect(out).toContain('Foundation wins on the dimensions');
  });

  it('renders the table with its header row and one row per line', () => {
    expect(out).toContain('Dimension | Foundation | Traditional');
    expect(out).toContain('Time (days) | ✓ | ✗');
    expect(out).toContain('Project costs | ✓ | ✗'); // {text} cells resolve too
  });

  it('keeps real sub-headings and bullets', () => {
    const withSub = harvestTextOfNodes(
      [node('heading', { level: 2, text: 'Approach' }), node('bulleted_list', { items: [{ text: 'point one' }] })],
      'Some Section',
    );
    expect(withSub).toContain('Approach');
    expect(withSub).toContain('• point one');
  });

  it('returns empty for an empty/undrafted section', () => {
    expect(harvestTextOfNodes([], 'x').trim()).toBe('');
  });
});
