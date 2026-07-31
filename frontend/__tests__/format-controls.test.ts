import { describe, it, expect } from 'vitest';
import { formatCapabilities, INSERT_ELEMENTS, SHAPE_KINDS } from '@/lib/canvas/format-controls';

// The ribbon drawer shows exactly the control groups a node type supports.
describe('formatCapabilities', () => {
  it('a shape supports text + box + arrange + the shape element control', () => {
    expect(formatCapabilities('shape')).toEqual({ text: true, box: true, arrange: true, element: 'shape' });
  });
  it('a plain text block is text-only (run styling, no box/arrange/element)', () => {
    expect(formatCapabilities('text_block')).toEqual({ text: true, box: false, arrange: false, element: null });
  });
  it('an image is a box + arrangeable figure with no run styling or element control', () => {
    expect(formatCapabilities('image')).toEqual({ text: false, box: true, arrange: true, element: null });
  });
  it('a divider exposes only its element (line style) control', () => {
    const c = formatCapabilities('divider');
    expect(c.text).toBe(false); expect(c.box).toBe(false); expect(c.arrange).toBe(false); expect(c.element).toBe('divider');
  });
  it('a callout is a text + box element but not free-arrangeable', () => {
    expect(formatCapabilities('callout')).toEqual({ text: true, box: true, arrange: false, element: 'callout' });
  });
  it('chart/text_box are arrangeable; callout/blockquote are not', () => {
    expect(formatCapabilities('chart').arrange).toBe(true);
    expect(formatCapabilities('text_box').arrange).toBe(true);
    expect(formatCapabilities('blockquote').arrange).toBe(false);
  });
  it('exposes a complete insert palette + shape kinds', () => {
    expect(INSERT_ELEMENTS.map((e) => e.type)).toContain('shape');
    expect(INSERT_ELEMENTS.map((e) => e.type)).toContain('chart');
    expect(SHAPE_KINDS.length).toBe(9);
  });
});
