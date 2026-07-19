import { describe, expect, it } from 'vitest';
import { pastProposalToCanvas } from '@/lib/templates/past-proposal-canvas';
import { extractTemplateSkeleton } from '@/lib/templates/extract-skeleton';
import { docNodes } from '@/lib/types/canvas-document';

/**
 * #18 templify — a past proposal's atoms are plain-text section chunks. The old path
 * (assembleArtifactCanvas → moldNodes) DROPPED bare prose and collapsed every section
 * into one empty "Section 1", losing the structure. pastProposalToCanvas lays the atoms
 * out directly so extractTemplateSkeleton keeps the full section skeleton.
 */
const ATOMS = [
  { title: 'Identification and Significance', content: 'The problem of counter-UAS detection in cluttered RF environments is significant.' },
  { title: 'Technical Objectives', content: 'Objective 1: real-time classification at TRL 5. Objective 2: integrate with the C2 stack.' },
  { title: 'Technical Approach', content: 'A staged approach: sensor fusion, edge inference, a transition-ready API.' },
  { title: 'Key Personnel', content: 'Dr. Rao (PI) led two prior Phase II efforts.' },
];

describe('pastProposalToCanvas — one section per atom, structure preserved', () => {
  it('builds a v2 doc with a section per atom (title→heading, prose→body)', () => {
    const doc = pastProposalToCanvas(ATOMS, 'technical_volume');
    expect(doc.version).toBe(2);
    expect(doc.sections).toHaveLength(ATOMS.length);
    expect((doc.sections ?? []).map((s) => s.title)).toEqual(ATOMS.map((a) => a.title));
    // each section carries a heading node (its title) + a body block
    const first = doc.sections![0];
    const nodes = first.groups.flatMap((g) => g.nodes);
    expect(nodes.find((n) => n.type === 'heading')).toBeTruthy();
    expect(nodes.find((n) => n.type === 'text_block')).toBeTruthy();
    // a real CanvasRules preset is attached (needed downstream by exporters)
    expect(doc.canvas?.format).toBeTruthy();
  });

  it('a heading-only atom (no content) still yields its section', () => {
    const doc = pastProposalToCanvas([{ title: 'Cover Sheet', content: null }], 'cover_sheet');
    expect(doc.sections).toHaveLength(1);
    expect(doc.sections![0].title).toBe('Cover Sheet');
  });

  it('falls back to a numbered title when an atom has none', () => {
    const doc = pastProposalToCanvas([{ title: null, content: 'Some prose.' }]);
    expect(doc.sections![0].title).toBe('Section 1');
  });

  it('extractTemplateSkeleton keeps ALL sections + titles in order (the regression)', () => {
    const canvas = pastProposalToCanvas(ATOMS, 'technical_volume');
    const { skeleton, sections } = extractTemplateSkeleton(canvas, {});
    expect(skeleton.sections).toHaveLength(ATOMS.length);
    expect((skeleton.sections ?? []).map((s) => s.title)).toEqual(ATOMS.map((a) => a.title));
    expect(sections.map((s) => s.title)).toEqual(ATOMS.map((a) => a.title));
    // skeleton keeps the headings (skin) but strips the prose (muted placeholders only)
    const nodeCount = docNodes(skeleton).length;
    expect(nodeCount).toBeGreaterThanOrEqual(ATOMS.length); // ≥ one heading per section
  });
});
