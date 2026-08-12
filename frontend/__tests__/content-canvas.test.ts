/**
 * content-canvas — the Content Studio ⇄ Canvas bridge (pure).
 * Proves the seed parser (markdown/HTML → nodes) and the public HTML projection.
 */
import { describe, it, expect } from 'vitest';
import {
  parseBodyToNodes, canvasFromDocBody, docBodyFromCanvas, newContentCanvas,
} from '@/lib/content-canvas';

describe('parseBodyToNodes (markdown)', () => {
  it('maps headings, paragraphs, and lists to the right node types', () => {
    const md = [
      '# Title',
      '',
      'A first paragraph of prose.',
      '',
      '## Why it matters',
      '- point one',
      '- point two',
      '',
      '1. step a',
      '2. step b',
    ].join('\n');
    const nodes = parseBodyToNodes(md);
    const types = nodes.map((n) => n.type);
    expect(types).toEqual([
      'heading',        // # Title
      'text_block',     // paragraph
      'heading',        // ## Why it matters
      'bulleted_list',  // - point one / two
      'numbered_list',  // 1. / 2.
    ]);
    // heading level captured
    expect((nodes[0].content as { level: number }).level).toBe(1);
    expect((nodes[2].content as { level: number }).level).toBe(2);
    // list items captured
    expect((nodes[3].content as { items: { text: string }[] }).items.map((i) => i.text)).toEqual(['point one', 'point two']);
    expect((nodes[4].content as { items: { text: string }[] }).items.map((i) => i.text)).toEqual(['step a', 'step b']);
  });

  it('joins consecutive prose lines into one paragraph', () => {
    const nodes = parseBodyToNodes('line one\nline two\nline three');
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('text_block');
    expect((nodes[0].content as { text: string }).text).toBe('line one line two line three');
  });
});

describe('parseBodyToNodes (HTML)', () => {
  it('downconverts h2/p/ul into heading + paragraph + list', () => {
    const html = '<h2>Section</h2><p>Body text here.</p><ul><li>alpha</li><li>beta</li></ul>';
    const nodes = parseBodyToNodes(html);
    expect(nodes.map((n) => n.type)).toEqual(['heading', 'text_block', 'bulleted_list']);
    expect((nodes[0].content as { text: string }).text).toBe('Section');
    expect((nodes[2].content as { items: { text: string }[] }).items.map((i) => i.text)).toEqual(['alpha', 'beta']);
  });

  it('decodes entities', () => {
    const nodes = parseBodyToNodes('<p>Cut cost &amp; schedule by 40&#37;</p>'.replace('&#37;', '%'));
    expect((nodes[0].content as { text: string }).text).toContain('Cut cost & schedule');
  });
});

describe('canvasFromDocBody + docBodyFromCanvas (round-trip)', () => {
  it('seeds a canvas whose HTML projection is an HTML fragment the public renderer accepts', () => {
    const canvas = canvasFromDocBody('My Post', '## Heading\n\nA paragraph.\n\n- a\n- b');
    expect(canvas.sections?.[0]?.groups?.[0]?.nodes.length).toBeGreaterThan(0);
    const html = docBodyFromCanvas(canvas);
    // public renderer keys on body.startsWith('<') to treat it as HTML
    expect(html.startsWith('<')).toBe(true);
    expect(html).toContain('Heading');
    expect(html).toContain('paragraph');
  });

  it('never yields an empty canvas (empty body → one empty text block)', () => {
    const canvas = canvasFromDocBody('Empty', '');
    const nodes = canvas.sections?.[0]?.groups?.[0]?.nodes ?? [];
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe('text_block');
  });

  it('uses the custom preset (no page budget) so web content raises no page-limit warning', () => {
    const canvas = canvasFromDocBody('X', 'hi');
    expect(canvas.canvas.max_pages == null || canvas.canvas.max_pages === 0).toBe(true);
  });
});

describe('newContentCanvas', () => {
  it('starts a new document with a title heading + empty paragraph', () => {
    const canvas = newContentCanvas('Fresh');
    const nodes = canvas.sections?.[0]?.groups?.[0]?.nodes ?? [];
    expect(nodes.map((n) => n.type)).toEqual(['heading', 'text_block']);
    expect((nodes[0].content as { text: string }).text).toBe('Fresh');
  });
});
