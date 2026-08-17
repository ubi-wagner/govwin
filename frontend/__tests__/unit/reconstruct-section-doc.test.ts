/**
 * reconstructSectionDoc / originalNodeId (fluid-canvas F2 editable surface).
 *
 * The editable fluid document holds every section's nodes concatenated into ONE doc (re-keyed
 * `${sectionId}__${nodeId}`, with synthetic `sec:${sectionId}` boundary headings). To save one
 * section it must be inverted back to that section's OWN flat doc: only its body nodes, ids
 * un-prefixed, the boundary dropped, wrapped in the section's own frame. A bug here would send
 * cross-section or synthetic nodes to the per-section save route (data corruption), so it is
 * pinned as a pure unit.
 */
import { describe, it, expect } from 'vitest';
import { reconstructSectionDoc, originalNodeId } from '@/lib/canvas/assemble-proposal';
import type { CanvasDocument } from '@/lib/types/canvas-document';

const node = (id: string, text: string) => ({ id, type: 'text_block', content: { text } });

const assembled = {
  version: 1,
  document_id: 'proposal-fluid',
  canvas: { format: 'document' },
  metadata: { title: 'Whole proposal' },
  nodes: [
    node('sec:A', 'A title'), // synthetic boundary
    node('A__n1', 'alpha'),
    node('A__n2', 'beta'),
    node('sec:B', 'B title'),
    node('B__n1', 'gamma'),
  ],
} as unknown as CanvasDocument;

const sectionOf: Record<string, { id: string; title: string }> = {
  'sec:A': { id: 'A', title: 'A title' },
  'A__n1': { id: 'A', title: 'A title' },
  'A__n2': { id: 'A', title: 'A title' },
  'sec:B': { id: 'B', title: 'B title' },
  'B__n1': { id: 'B', title: 'B title' },
};

const frame = { format: 'document', margins: { top: 1 } } as unknown as CanvasDocument['canvas'];
const meta = { title: 'Section A', status: 'in_progress' } as unknown as CanvasDocument['metadata'];

describe('reconstructSectionDoc', () => {
  it('returns only the section-owned body nodes, un-prefixed, boundary dropped, in order', () => {
    const doc = reconstructSectionDoc(assembled, sectionOf, 'A', frame, meta);
    expect(doc.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(doc.nodes.map((n) => (n.content as { text: string }).text)).toEqual(['alpha', 'beta']);
    expect(doc.canvas).toBe(frame); // the section's OWN frame, not the assembled one
    expect(doc.metadata).toBe(meta);
    expect(doc.document_id).toBe('section-A');
  });

  it('excludes other sections and the synthetic boundary heading', () => {
    const doc = reconstructSectionDoc(assembled, sectionOf, 'B', frame, meta);
    expect(doc.nodes.map((n) => n.id)).toEqual(['n1']); // B__n1 → n1
    expect(doc.nodes.every((n) => !n.id.startsWith('sec:'))).toBe(true);
  });

  it('a section with no body nodes reconstructs to an empty node list (never the boundary)', () => {
    const doc = reconstructSectionDoc(assembled, { 'sec:C': { id: 'C', title: 'C' } }, 'C', frame, meta);
    expect(doc.nodes).toEqual([]);
  });

  it('originalNodeId strips the owning prefix and leaves foreign / bare ids intact', () => {
    expect(originalNodeId('A__n1', 'A')).toBe('n1');
    expect(originalNodeId('bare', 'A')).toBe('bare');
    expect(originalNodeId('B__n1', 'A')).toBe('B__n1'); // a different section's prefix is untouched
  });
});
