import { describe, it, expect } from 'vitest';
import { markdownToCanvasDocument, groupNodesIntoSections } from '@/lib/import/markdown-canvas';
import { parseMarkdown, stripInlineMarkdown } from '@/lib/import/text-reader';

const MD = `# Proposal Title

Intro paragraph with **bold** and \`code\` markers.

## Section A

- first item
- second item

## Section B

1. step one
2. step two
`;

describe('stripInlineMarkdown', () => {
  it('removes bold / underscore-bold / inline-code markers', () => {
    expect(stripInlineMarkdown('a **b** c __d__ e `f`')).toBe('a b c d e f');
  });
  it('clears stray unmatched **', () => {
    expect(stripInlineMarkdown('weird ** left over')).toBe('weird  left over');
  });
});

describe('parseMarkdown (product parser)', () => {
  const nodes = parseMarkdown(MD);
  it('detects headings, bulleted and numbered lists, and paragraphs', () => {
    expect(nodes.some((n) => n.type === 'heading')).toBe(true);
    expect(nodes.some((n) => n.type === 'bulleted_list')).toBe(true);
    expect(nodes.some((n) => n.type === 'numbered_list')).toBe(true);
    expect(nodes.some((n) => n.type === 'text_block')).toBe(true);
  });
  it('leaves no literal ** / backtick markers in the parsed text', () => {
    const json = JSON.stringify(nodes);
    expect(json).not.toContain('**');
    expect(json).not.toContain('`');
  });
});

describe('markdownToCanvasDocument', () => {
  it('builds a v2 doc with one section per heading', () => {
    const doc = markdownToCanvasDocument(MD, { title: 'T' });
    expect(doc.version).toBe(2);
    expect(doc.sections?.length).toBe(3); // Title, Section A, Section B
    expect(doc.sections?.[0].title).toBe('Proposal Title');
    expect(doc.metadata.title).toBe('T');
    expect(doc.metadata.status).toBe('ai_drafted');
  });
  it('honors a footer template and a deterministic timestamp', () => {
    const doc = markdownToCanvasDocument(MD, { title: 'T', footerTemplate: 'ACME · {n} / {N}', createdAt: '2026-01-01T00:00:00Z' });
    expect(doc.canvas.footer?.template).toBe('ACME · {n} / {N}');
    expect(doc.metadata.created_at).toBe('2026-01-01T00:00:00Z');
  });
  it('groupNodesIntoSections keeps a heading with the body that follows it', () => {
    const secs = groupNodesIntoSections(parseMarkdown(MD));
    expect(secs.length).toBe(3);
    // Section A holds the heading + its bulleted list
    const a = secs[1];
    expect(a.title).toBe('Section A');
    expect(a.groups[0].nodes.some((n) => n.type === 'bulleted_list')).toBe(true);
  });
});
