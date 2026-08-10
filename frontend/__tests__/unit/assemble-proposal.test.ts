import { describe, it, expect } from 'vitest';
import { assembleProposalDocument } from '@/lib/canvas/assemble-proposal';

const sectionDoc = (texts: string[]) => JSON.stringify({
  version: 1, document_id: 'd',
  canvas: { format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 }, header: null, footer: null, font_default: { family: 'Times New Roman', size: 12 }, line_spacing: 1.15, max_pages: null, max_slides: null },
  nodes: texts.map((t, i) => ({ id: `n${i}`, type: 'text_block', content: { text: t }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false })),
  metadata: {},
});

describe('assembleProposalDocument — whole-proposal fluid document', () => {
  it('concatenates sections into one doc with an inline title heading per section', () => {
    const { doc, outline } = assembleProposalDocument([
      { id: 'sA', title: 'Approach', content: sectionDoc(['a1', 'a2']) },
      { id: 'sB', title: 'Team', content: sectionDoc(['b1']) },
    ]);
    // 2 section headings + 3 body nodes
    expect(doc.nodes).toHaveLength(5);
    expect(doc.nodes[0].type).toBe('heading');
    expect((doc.nodes[0].content as { text: string }).text).toBe('Approach');
    expect((doc.nodes[3].content as { text: string }).text).toBe('Team');
    expect(outline.map((o) => o.title)).toEqual(['Approach', 'Team']);
  });

  it('maps every node back to its owning section (for action routing)', () => {
    const { doc, sectionOf } = assembleProposalDocument([
      { id: 'sA', title: 'Approach', content: sectionDoc(['a1']) },
      { id: 'sB', title: 'Team', content: sectionDoc(['b1']) },
    ]);
    for (const n of doc.nodes) {
      expect(sectionOf[n.id]).toBeTruthy();
    }
    // body node of section A belongs to sA
    const aBody = doc.nodes.find((n) => (n.content as { text?: string }).text === 'a1')!;
    expect(sectionOf[aBody.id].id).toBe('sA');
    expect(sectionOf[aBody.id].title).toBe('Approach');
  });

  it('re-keys node ids so they are unique across sections (no collisions)', () => {
    // both sections use ids n0 — assembled ids must differ
    const { doc } = assembleProposalDocument([
      { id: 'sA', title: 'A', content: sectionDoc(['x']) },
      { id: 'sB', title: 'B', content: sectionDoc(['y']) },
    ]);
    const ids = doc.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
  });

  it('outline anchors point at real heading nodes (scroll targets)', () => {
    const { doc, outline } = assembleProposalDocument([{ id: 'sA', title: 'Approach', content: sectionDoc(['a1']) }]);
    const anchor = outline[0].anchorNodeId;
    expect(doc.nodes.find((n) => n.id === anchor)?.type).toBe('heading');
  });

  it('tolerates an empty/blank section (heading only, no body)', () => {
    const { doc, outline } = assembleProposalDocument([{ id: 'sA', title: 'Empty', content: null }]);
    expect(outline).toHaveLength(1);
    expect(doc.nodes).toHaveLength(1); // just the title heading
    expect(doc.nodes[0].type).toBe('heading');
  });
});
