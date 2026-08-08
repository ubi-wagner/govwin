import { describe, expect, it } from 'vitest';
import {
  toSections,
  sectionsToNodes,
  docNodes,
  createSection,
  createGroup,
  liftToFlowSections,
  toEditableFlat,
  CANVAS_PRESETS,
  type CanvasDocument,
  type CanvasNode,
  type CanvasSection,
} from '@/lib/types/canvas-document';
import { renderCanvasToHtml } from '@/lib/export/canvas-html';
import { paginate } from '@/lib/export/paginate';

// ─── minimal node/doc builders ──────────────────────────────────────
const node = (type: CanvasNode['type'], content: unknown, style: Record<string, unknown> = {}): CanvasNode => ({
  id: `${type}-${Math.round(content && typeof content === 'object' ? 0 : 0)}-${Math.random().toString(36).slice(2, 7)}`,
  type, content: content as CanvasNode['content'], style: style as CanvasNode['style'],
  provenance: { source: 'manual' }, history: [], library_eligible: false,
});
const heading = (text: string) => node('heading', { level: 2, text });
const para = (text: string) => node('text_block', { text });
const brk = () => node('page_break', null);
const meta = { title: 'T', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'ai_drafted' as const };

const v1 = (nodes: CanvasNode[]): CanvasDocument => ({ version: 1, document_id: 'd1', canvas: CANVAS_PRESETS.letter_sbir_phase1, nodes, metadata: meta });
const v2 = (sections: CanvasSection[]): CanvasDocument => ({ version: 2, document_id: 'd2', canvas: CANVAS_PRESETS.letter_sbir_phase1, nodes: [], sections, metadata: meta });

describe('toSections — v1 lift', () => {
  it('wraps a flat node list with no page_break in ONE flow section', () => {
    const secs = toSections(v1([heading('A'), para('a1'), para('a2')]));
    expect(secs).toHaveLength(1);
    expect(secs[0].layout.mode).toBe('flow');
    expect(secs[0].layout.break_before).toBeUndefined();
    expect(secs[0].title).toBe('A'); // first heading becomes the section title
    expect(secs[0].groups[0].nodes).toHaveLength(3);
  });

  it('splits on page_break; the FIRST section has no break, the rest carry break_before', () => {
    const secs = toSections(v1([heading('A'), para('a'), brk(), heading('B'), para('b'), brk(), heading('C')]));
    expect(secs.map((s) => s.title)).toEqual(['A', 'B', 'C']);
    expect(secs[0].layout.break_before).toBeUndefined();
    expect(secs[1].layout.break_before).toBe(true);
    expect(secs[2].layout.break_before).toBe(true);
    // page_break nodes are consumed, not kept as content
    expect(sectionsToNodes(secs).some((n) => n.type === 'page_break')).toBe(false);
  });

  it('returns a v2 doc’s own sections unchanged', () => {
    const s = createSection({ title: 'X', nodes: [para('x')] });
    expect(toSections(v2([s]))[0]).toBe(s);
  });
});

describe('docNodes / sectionsToNodes', () => {
  it('flattens a v2 doc to its content nodes; returns a v1 doc’s nodes as-is', () => {
    const doc2 = v2([createSection({ nodes: [heading('A'), para('a')] }), createSection({ nodes: [para('b')] })]);
    expect(docNodes(doc2).map((n) => n.type)).toEqual(['heading', 'text_block', 'text_block']);
    const nodes = [heading('A'), para('a')];
    expect(docNodes(v1(nodes))).toBe(nodes);
  });

  it('createGroup keep-together + createSection layout thread through', () => {
    const g = createGroup([para('x')], { keepTogether: true, label: 'Fig' });
    expect(g.keep_together).toBe(true);
    expect(g.label).toBe('Fig');
    const s = createSection({ title: 'S', layout: { mode: 'keep_together' }, groups: [g] });
    expect(s.layout.mode).toBe('keep_together');
  });
});

describe('renderCanvasToHtml — section awareness', () => {
  it('v1 doc uses the flat path — no <section> wrapper, page_break still renders', () => {
    const html = renderCanvasToHtml(v1([para('a'), brk(), para('b')]));
    expect(html).not.toContain('<section');
    expect(html).toContain('page-break-after:always');
  });

  it('v2 doc wraps sections; break_before → page-break-before, keep_together → break-inside:avoid', () => {
    const doc = v2([
      createSection({ nodes: [para('one')] }),
      createSection({ layout: { mode: 'flow', break_before: true }, nodes: [para('two')] }),
      createSection({ layout: { mode: 'keep_together' }, groups: [createGroup([para('three')], { keepTogether: true })] }),
    ]);
    const html = renderCanvasToHtml(doc);
    expect((html.match(/<section/g) ?? [])).toHaveLength(3);
    expect(html).toContain('page-break-before:always'); // the break_before section
    expect(html).toContain('break-inside:avoid');        // keep_together section + group
  });

  it('does NOT emit page-break-before on the first section even if flagged', () => {
    const html = renderCanvasToHtml(v2([createSection({ layout: { mode: 'flow', break_before: true }, nodes: [para('x')] })]));
    expect(html).not.toContain('page-break-before:always');
  });
});

describe('liftToFlowSections', () => {
  const image = () => node('image', { storage_key: 'data:x', alt_text: 'a' });
  const caption = () => node('caption', { prefix: 'Figure', number: 1, text: 'c' });
  const table = () => node('table', { headers: ['h'], rows: [['x']] });

  it('drops forced page_breaks → flow sections with no break_before', () => {
    const lifted = liftToFlowSections(v1([heading('A'), para('a'), brk(), heading('B'), para('b')]));
    expect(lifted.version).toBe(2);
    expect(lifted.nodes).toEqual([]);
    expect(lifted.sections).toHaveLength(2);
    expect(lifted.sections!.every((s) => s.layout.mode === 'flow')).toBe(true);
    expect(lifted.sections!.every((s) => !s.layout.break_before)).toBe(true);
    // the page_break itself is gone
    expect(sectionsToNodes(lifted.sections!).some((n) => n.type === 'page_break')).toBe(false);
  });

  it('coalesces an image+caption and a table+caption into keep_together groups', () => {
    const lifted = liftToFlowSections(v1([para('intro'), image(), caption(), para('mid'), table(), caption()]));
    const groups = lifted.sections![0].groups;
    const keep = groups.filter((g) => g.keep_together);
    expect(keep).toHaveLength(2);
    expect(keep[0].nodes.map((n) => n.type)).toEqual(['image', 'caption']);
    expect(keep[1].nodes.map((n) => n.type)).toEqual(['table', 'caption']);
    // the surrounding prose stays in flowing (non-keep) groups
    expect(groups.some((g) => !g.keep_together && g.nodes.some((n) => n.type === 'text_block'))).toBe(true);
  });

  it('is a no-op on a doc that already has sections', () => {
    const doc = v2([createSection({ nodes: [para('x')] })]);
    expect(liftToFlowSections(doc)).toBe(doc);
  });
});

describe('toEditableFlat — v2 docs must be editable in the canvas', () => {
  it('passes a v1 doc through untouched', () => {
    const d = v1([heading('A'), para('a')]);
    expect(toEditableFlat(d)).toBe(d);
  });

  it('flattens a v2 DOCUMENT to visible nodes (no synthetic breaks, sections cleared)', () => {
    const doc = v2([
      createSection({ nodes: [heading('1'), para('a')] }),
      createSection({ nodes: [heading('2'), para('b')] }),
    ]);
    const flat = toEditableFlat(doc);
    expect(flat.version).toBe(1);
    expect(flat.sections).toBeUndefined();
    expect(flat.nodes.map((n) => n.type)).toEqual(['heading', 'text_block', 'heading', 'text_block']);
    expect(flat.nodes.some((n) => n.type === 'page_break')).toBe(false); // documents flow
  });

  it('flattens a v2 SLIDE deck keeping slide boundaries as page_breaks', () => {
    const slideCanvas = { ...CANVAS_PRESETS.letter_sbir_phase1, format: 'slide_16_9' as const };
    const doc: CanvasDocument = {
      version: 2, document_id: 'd', canvas: slideCanvas, nodes: [],
      sections: [createSection({ nodes: [heading('S1')] }), createSection({ nodes: [heading('S2')] }), createSection({ nodes: [heading('S3')] })],
      metadata: meta,
    };
    const flat = toEditableFlat(doc);
    expect(flat.nodes.filter((n) => n.type === 'page_break')).toHaveLength(2); // 3 slides → 2 breaks
    expect(flat.nodes[0].type).toBe('heading');
    expect(flat.nodes.map((n) => n.type)).toEqual(['heading', 'page_break', 'heading', 'page_break', 'heading']);
  });
});

describe('paginate', () => {
  it('reports a page per section span and honors max_pages', () => {
    const doc = v2([
      createSection({ title: 'A', nodes: [heading('A'), para('short')] }),
      createSection({ title: 'B', nodes: [para('short')] }),
    ]);
    const r = paginate(doc);
    expect(r.totalPages).toBeGreaterThanOrEqual(1);
    expect(r.perSection).toHaveLength(2);
    expect(r.perSection[0].title).toBe('A');
    expect(r.vsMaxPages.max).toBe(CANVAS_PRESETS.letter_sbir_phase1.max_pages);
  });

  it('a break_before section starts a new page', () => {
    const doc = v2([
      createSection({ title: 'A', nodes: [para('x')] }),
      createSection({ title: 'B', layout: { mode: 'flow', break_before: true }, nodes: [para('y')] }),
    ]);
    const r = paginate(doc);
    expect(r.perSection[1].startPage).toBe(2);
    expect(r.totalPages).toBeGreaterThanOrEqual(2);
  });

  it('lifts + paginates a v1 doc without throwing', () => {
    const r = paginate(v1([heading('A'), para('a'), brk(), heading('B'), para('b')]));
    expect(r.perSection).toHaveLength(2);
    expect(r.perSection[1].startPage).toBe(2);
  });
});

describe('renderCanvasToHtml — table of contents (regression: was silently dropped)', () => {
  const toc = (): CanvasNode => node('toc', {});
  it('renders a heading-list TOC from the document headings', () => {
    const html = renderCanvasToHtml(v1([heading('Intro'), toc(), heading('Approach'), para('body')]));
    const m = html.match(/<nav data-toc[\s\S]*?<\/nav>/);
    expect(m).toBeTruthy();
    const nav = m![0];
    expect(nav).toContain('Table of Contents');
    expect(nav).toContain('Intro');
    expect(nav).toContain('Approach');
  });
  it('emits nothing for a toc node when the document has no headings', () => {
    expect(renderCanvasToHtml(v1([toc(), para('body only')]))).not.toContain('data-toc');
  });
});
