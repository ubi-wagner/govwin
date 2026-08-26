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

  it('decodes named AND numeric entities (no literal leftovers)', () => {
    const nodes = parseBodyToNodes('<p>Cut cost &amp; schedule by 40&#37; &mdash; done &#x2019;</p>');
    const text = (nodes[0].content as { text: string }).text;
    expect(text).toContain('Cut cost & schedule by 40%'); // &amp; and &#37; both decoded
    expect(text).toContain('—');                          // &mdash;
    expect(text).toContain('’');                           // &#x2019;
    expect(text).not.toMatch(/&#?\w+;/);                   // no undecoded entity survives
  });

  it('preserves ordered vs unordered lists (no <ol>→<ul> downgrade)', () => {
    const bul = parseBodyToNodes('<ul><li>a</li><li>b</li></ul>');
    const num = parseBodyToNodes('<ol><li>one</li><li>two</li></ol>');
    expect(bul[0].type).toBe('bulleted_list');
    expect(num[0].type).toBe('numbered_list');
  });
});

describe('canvasFromDocBody + docBodyFromCanvas (round-trip)', () => {
  it('seeds a canvas whose HTML projection is SELF-STYLED semantic HTML (no .prose dependency)', () => {
    const canvas = canvasFromDocBody('My Post', '## Heading\n\nA paragraph.\n\n- a\n- b\n\n1. one\n2. two');
    expect(canvas.sections?.[0]?.groups?.[0]?.nodes.length).toBeGreaterThan(0);
    const html = docBodyFromCanvas(canvas);
    // public renderer keys on body.startsWith('<') to treat it as HTML
    expect(html.startsWith('<')).toBe(true);
    expect(html).toContain('Heading');
    expect(html).toContain('paragraph');
    // The marketing site has no @tailwindcss/typography (.prose); the projection MUST carry its own
    // inline web styles so headings/lists/links survive Tailwind Preflight. Guards the regression.
    expect(html).toMatch(/<h2 style=/);                 // headings styled
    expect(html).toMatch(/<ul style="[^"]*list-style:disc/); // bullets restored
    expect(html).toMatch(/<ol style="[^"]*list-style:decimal/); // numbers restored
    expect(html).not.toMatch(/<(h2|ul|ol)>/);           // never a bare unstyled tag
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

describe('inline markdown never reaches a published page (B104)', () => {
  const textOf = (n: { content: unknown }) => (n.content as { text: string }).text;
  const itemsOf = (n: { content: unknown }) => (n.content as { items: { text: string }[] }).items;
  const fmtsOf = (n: { content: unknown }) =>
    (n.content as { inline_formats?: { start: number; length: number; format: string }[] }).inline_formats ?? [];

  it('turns **bold** and *italic* into inline_formats, not literal asterisks', () => {
    const [n] = parseBodyToNodes('**SBIR** and **STTR** award *non-dilutive* funding.');
    expect(textOf(n)).toBe('SBIR and STTR award non-dilutive funding.');
    expect(textOf(n)).not.toContain('*');
    const f = fmtsOf(n);
    expect(f).toHaveLength(3);
    // offsets must address the STRIPPED text, or the emphasis lands on the wrong words
    expect(f.filter((x) => x.format === 'bold').map((x) => textOf(n).slice(x.start, x.start + x.length)))
      .toEqual(['SBIR', 'STTR']);
    expect(f.filter((x) => x.format === 'italic').map((x) => textOf(n).slice(x.start, x.start + x.length)))
      .toEqual(['non-dilutive']);
  });

  it('projects those formats to <strong>/<em> in the public HTML', () => {
    const html = docBodyFromCanvas(canvasFromDocBody('T', '**bold** then *soft*.'));
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>soft</em>');
    expect(html).not.toContain('*');
  });

  it('flattens a markdown link to "text (url)" — the canvas has no href to put it in', () => {
    const [n] = parseBodyToNodes('See the [eligibility checklist](/resources/sbir-sttr-eligibility-check).');
    expect(textOf(n)).toBe('See the eligibility checklist (/resources/sbir-sttr-eligibility-check).');
    expect(textOf(n)).not.toContain('](');
  });

  it('strips emphasis inside list items and headings, which cannot carry inline_formats', () => {
    const nodes = parseBodyToNodes('## **Why** it matters\n- **Phase I** — proof of concept.\n- plain');
    expect(textOf(nodes[0])).toBe('Why it matters');
    expect(itemsOf(nodes[1]).map((i) => i.text)).toEqual(['Phase I — proof of concept.', 'plain']);
    expect(JSON.stringify(nodes)).not.toContain('**');
  });

  it('spans an emphasis run that opens on one line and closes on the next', () => {
    const [n] = parseBodyToNodes('a **bold phrase\nthat wraps** end');
    expect(textOf(n)).toBe('a bold phrase that wraps end');
    expect(fmtsOf(n)).toHaveLength(1);
  });

  it('counts offsets in code points, so an emoji does not slide the format right', () => {
    const [n] = parseBodyToNodes('🚀 **rocket**');
    const [f] = fmtsOf(n);
    expect([...textOf(n)].slice(f.start, f.start + f.length).join('')).toBe('rocket');
  });

  it('leaves underscores and lone asterisks alone (snake_case, SF-424A, a * b)', () => {
    const [n] = parseBodyToNodes('page_key and 2 * 3 and file_name.txt');
    expect(textOf(n)).toBe('page_key and 2 * 3 and file_name.txt');
    expect(fmtsOf(n)).toHaveLength(0);
  });
});
