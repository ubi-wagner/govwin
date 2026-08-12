import { describe, it, expect } from 'vitest';
import { selectionToModel, selectionLabel } from '@/lib/canvas/selection';
import type { CanvasDocument } from '@/lib/types/canvas-document';

let seq = 0;
const base = () => ({ id: `n${seq++}`, style: {}, provenance: { source: 'test' }, history: [], library_eligible: false });
const text = (t: string) => ({ ...base(), type: 'text_block', content: { text: t } });
const heading = (t: string) => ({ ...base(), type: 'heading', content: { text: t, level: 2 } });
const brk = () => ({ ...base(), type: 'page_break', content: {} });

const v1 = (nodes: unknown[]) => ({ version: 1, document_id: 'd', canvas: { format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 }, header: null, footer: null, font_default: { family: 'Times New Roman', size: 12 }, line_spacing: 1.15, max_pages: null, max_slides: null }, nodes, metadata: {} }) as unknown as CanvasDocument;

describe('selectionToModel — Range→model mapping', () => {
  it('a single-node selection returns that node + its text', () => {
    const h = heading('Approach'); const p = text('We will 3D-print resilient housing.');
    const doc = v1([h, p]);
    const sel = selectionToModel(doc, (p as { id: string }).id, (p as { id: string }).id)!;
    expect(sel.nodeIds).toEqual([(p as { id: string }).id]);
    expect(sel.text).toContain('resilient housing');
    expect(sel.singleNode).toBe(true);
  });

  it('spans the contiguous run of nodes between two anchors, in order', () => {
    const a = heading('A'); const b = text('body one'); const c = text('body two');
    const doc = v1([a, b, c]);
    const sel = selectionToModel(doc, (a as { id: string }).id, (c as { id: string }).id)!;
    expect(sel.nodeIds).toEqual([(a as { id: string }).id, (b as { id: string }).id, (c as { id: string }).id]);
    expect(sel.text).toBe('A\n\nbody one\n\nbody two');
    expect(sel.singleNode).toBe(false);
  });

  it('is order-independent — dragging upward (end before start) still works', () => {
    const a = text('first'); const b = text('second');
    const doc = v1([a, b]);
    const forward = selectionToModel(doc, (a as { id: string }).id, (b as { id: string }).id)!;
    const backward = selectionToModel(doc, (b as { id: string }).id, (a as { id: string }).id)!;
    expect(backward.nodeIds).toEqual(forward.nodeIds);
    expect(backward.text).toBe(forward.text);
  });

  it('returns null when an anchor is not a real node (selection began outside the canvas)', () => {
    const doc = v1([text('x')]);
    expect(selectionToModel(doc, 'ghost', 'ghost')).toBeNull();
  });

  it('reports the content groups a selection spans (page-break delimited)', () => {
    const a = heading('Section A'); const b = text('a body');
    const c = heading('Section B'); const d = text('b body');
    const doc = v1([a, b, brk(), c, d]);
    // select from a-body across the break into section B's heading
    const sel = selectionToModel(doc, (b as { id: string }).id, (c as { id: string }).id)!;
    expect(sel.groupTitles.length).toBeGreaterThanOrEqual(2); // spans two sections
  });

  it('selectionLabel truncates to a readable chip', () => {
    const long = 'x'.repeat(100);
    expect(selectionLabel({ nodeIds: ['1'], text: long, groupTitles: [], singleNode: true }).length).toBeLessThanOrEqual(60);
    expect(selectionLabel({ nodeIds: ['1', '2'], text: '', groupTitles: [], singleNode: false })).toContain('block');
  });
});
