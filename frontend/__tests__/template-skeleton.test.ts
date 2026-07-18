import { describe, expect, it } from 'vitest';
import { extractTemplateSkeleton } from '@/lib/templates/extract-skeleton';
import { sectionsToNodes, createSection, createGroup, CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';

const node = (type: CanvasNode['type'], content: unknown, style: Record<string, unknown> = {}): CanvasNode => ({
  id: `${type}-${Math.random().toString(36).slice(2, 7)}`, type, content: content as CanvasNode['content'], style: style as CanvasNode['style'],
  provenance: { source: 'manual' }, history: [], library_eligible: false,
});
const heading = (text: string, color?: string) => node('heading', { level: 2, text }, color ? { color } : {});
const para = (text: string) => node('text_block', { text });
const image = () => node('image', { storage_key: 'data:x', alt_text: 'a' });
const table = () => node('table', { headers: ['h'], rows: [['x']] });
const meta = { title: 'AFWERX TV', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted' as const };

describe('extractTemplateSkeleton', () => {
  it('keeps the frame + heading (skin) and strips content, preserving the muscle (group) anatomy', () => {
    const doc: CanvasDocument = {
      version: 2, document_id: 'd', canvas: CANVAS_PRESETS.letter_sbir_phase1, nodes: [],
      sections: [
        createSection({ title: '1. Significance', layout: { mode: 'flow' }, groups: [createGroup([heading('1. Significance', '#0e7490'), para('lots of prose'), para('more prose')])] }),
        createSection({ title: '2. Approach', layout: { mode: 'flow', page_budget: 3 }, groups: [
          createGroup([heading('2. Approach'), para('approach prose')]),                       // narrative muscle
          createGroup([image(), node('caption', { prefix: 'Figure', number: 1, text: 'x' })], { keepTogether: true, label: 'Figure 1' }), // figure muscle
          createGroup([table()], { keepTogether: true }),                                        // table muscle
        ] }),
      ],
      metadata: meta,
    };
    const { skeleton, sections } = extractTemplateSkeleton(doc);

    expect(skeleton.version).toBe(2);
    expect(skeleton.canvas).toBe(doc.canvas); // skeleton = frame preserved
    expect(skeleton.sections).toHaveLength(2); // organs
    // no content survives — placeholders only
    expect(sectionsToNodes(skeleton.sections!).some((n) => n.type === 'image' || n.type === 'table')).toBe(false);
    // heading text + color (skin) preserved
    expect((skeleton.sections![0].groups[0].nodes[0].content as { text: string }).text).toBe('1. Significance');
    expect(skeleton.sections![0].groups[0].nodes[0].style.color).toBe('#0e7490');
    // muscles: section 2 keeps its THREE group slots, figure/table stay keep_together
    const s2 = skeleton.sections![1];
    expect(s2.groups).toHaveLength(3);
    expect(s2.groups[1].keep_together).toBe(true);
    expect(s2.groups[1].label).toBe('Figure 1');
    expect(s2.groups[2].keep_together).toBe(true);
    // per-section summary lists the typed, swappable slots (the "replaceable organs/muscles")
    expect(sections[1].slots.map((sl) => sl.kind)).toEqual(['narrative', 'figure', 'table']);
    expect(sections[1].slots[1].keepTogether).toBe(true);
  });

  it('preserves layout intent (break_before / page_budget) and honors budget overrides', () => {
    const doc: CanvasDocument = {
      version: 2, document_id: 'd', canvas: CANVAS_PRESETS.letter_sbir_phase1, nodes: [],
      sections: [
        createSection({ title: 'A', layout: { mode: 'keep_together', break_before: true, page_budget: 2 }, groups: [createGroup([heading('A'), para('x')])] }),
      ],
      metadata: meta,
    };
    const kept = extractTemplateSkeleton(doc).skeleton.sections![0];
    expect(kept.layout.mode).toBe('keep_together');
    expect(kept.layout.break_before).toBe(true);
    expect(kept.layout.page_budget).toBe(2);

    const overridden = extractTemplateSkeleton(doc, { sectionBudgets: { 0: 5 } });
    expect(overridden.skeleton.sections![0].layout.page_budget).toBe(5);
    expect(overridden.sections[0].pageBudget).toBe(5);
  });

  it('lifts a v1 flat doc (split on page_break) into a skeleton', () => {
    const brk = node('page_break', null);
    const doc: CanvasDocument = {
      version: 1, document_id: 'd', canvas: CANVAS_PRESETS.letter_sbir_phase1,
      nodes: [heading('1. Intro'), para('prose'), brk, heading('2. Body'), para('prose'), image()],
      metadata: meta,
    };
    const { skeleton } = extractTemplateSkeleton(doc);
    expect(skeleton.sections).toHaveLength(2);
    expect(skeleton.sections!.map((s) => s.title)).toEqual(['1. Intro', '2. Body']);
    expect(sectionsToNodes(skeleton.sections!).some((n) => n.type === 'image')).toBe(false);
  });
});
