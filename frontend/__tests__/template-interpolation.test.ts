/**
 * interpolateTemplate — JSON-safety contract (adversarial sweep 2026-08-18, HIGH-1).
 *
 * The merge-field replacement happens INSIDE the serialized document, so a raw quote,
 * backslash, or newline in a variable VALUE (tenant names and topic titles are
 * user-authored) used to corrupt the parse — failing the whole release inside the
 * provision transaction — or worse, parse "successfully" with injected structure.
 * Values must round-trip byte-exact; placeholders without a value stay intact.
 */
import { describe, expect, it } from 'vitest';
import { interpolateTemplate } from '@/lib/templates';
import type { CanvasDocument } from '@/lib/types/canvas-document';

const doc = (text: string) => ({
  version: 1,
  document_id: 'd1',
  canvas: { format: 'letter' },
  nodes: [{ id: 'n1', type: 'text_block', content: { text }, style: {}, history: [] }],
  metadata: { title: 't' },
} as unknown as CanvasDocument);

const textOf = (d: CanvasDocument) =>
  ((d as unknown as { nodes: Array<{ content: { text: string } }> }).nodes[0].content.text);

describe('interpolateTemplate JSON safety', () => {
  it('splices quotes, backslashes, and newlines without corrupting the document', () => {
    const out = interpolateTemplate(doc('Proposal by {company_name} for {topic_title}'), {
      company_name: 'Tech"Node\\LLC',
      topic_title: 'Line one\nLine two\ttabbed',
    });
    expect(textOf(out)).toBe('Proposal by Tech"Node\\LLC for Line one\nLine two\ttabbed');
  });

  it('a structural-injection value stays a plain string (no new properties)', () => {
    const out = interpolateTemplate(doc('{company_name}'), {
      company_name: 'X", "malicious": "1',
    });
    expect(textOf(out)).toBe('X", "malicious": "1');
    const node = (out as unknown as { nodes: Array<{ content: Record<string, unknown> }> }).nodes[0];
    expect(Object.keys(node.content)).toEqual(['text']);
  });

  it('unknown placeholders and uppercase brackets stay intact', () => {
    const out = interpolateTemplate(doc('{pi_name} keeps {N} and {UPPER}'), { company_name: 'x' });
    expect(textOf(out)).toBe('{pi_name} keeps {N} and {UPPER}');
  });
});
