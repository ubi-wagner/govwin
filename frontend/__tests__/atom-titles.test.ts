/**
 * AN ATOM IS NEVER NAMED AFTER A NODE TYPE.
 *
 * `probe-customer-finish` found 48 atoms sitting in customers' libraries titled `bulleted_list`.
 * The atomizer's fallback returned `n.type` verbatim, so every list, image, link, caption and
 * footnote atom carried the system's own vocabulary as its name. It is B136 in another surface —
 * an internal term shown to the company that bought a proposal portal — and like B136 it never
 * looked broken, which is exactly why it survived every lens: the page rendered, the string was
 * present, the API answered 200.
 *
 * A library is browsed BY TITLE. Forty-eight identically-named rows are not a cosmetic problem;
 * they are a shelf the owner cannot search.
 *
 * These cases are written against the shapes in `lib/types/canvas-document.ts` (ListContent,
 * ImageContent, UrlContent, CaptionContent, FootnoteContent) rather than shapes I assumed — the
 * repo's rule about copying the predicate from the source applies to fixtures too.
 */
import { describe, it, expect } from 'vitest';
import { nodeLabel } from '@/lib/library/foundation';
import type { CanvasNode } from '@/lib/types/canvas-document';

const node = (type: string, content: unknown): CanvasNode =>
  ({ id: 'n1', type, content } as unknown as CanvasNode);

describe('a primitive atom is named from its content, never from its node type', () => {
  it('a bulleted list is named by its first item', () => {
    const { title } = nodeLabel(node('bulleted_list', {
      items: [{ text: 'Autonomous inspection for expeditionary basing' }, { text: 'Second item' }],
    }));
    expect(title).toBe('Autonomous inspection for expeditionary basing');
  });

  it('a numbered list is named by its first item', () => {
    const { title } = nodeLabel(node('numbered_list', { items: [{ text: 'Kick-off review' }] }));
    expect(title).toBe('Kick-off review');
  });

  it('an image is named by its caption, falling back to alt text', () => {
    expect(nodeLabel(node('image', { caption: 'Figure 2 — thrust curve', alt_text: 'a chart' })).title)
      .toBe('Figure 2 — thrust curve');
    expect(nodeLabel(node('image', { alt_text: 'System block diagram', storage_key: 'k' })).title)
      .toBe('System block diagram');
  });

  it('a link is named by what it displays, falling back to the href', () => {
    expect(nodeLabel(node('url', { display_text: 'SBIR topic page', href: 'https://x.test' })).title)
      .toBe('SBIR topic page');
    expect(nodeLabel(node('url', { href: 'https://sbir.test/topic/1', display_text: '' })).title)
      .toBe('https://sbir.test/topic/1');
  });

  it('a caption and a footnote are named by their text', () => {
    expect(nodeLabel(node('caption', { prefix: 'Figure', number: 1, text: 'Airframe layout' })).title)
      .toBe('Airframe layout');
    expect(nodeLabel(node('footnote', { marker: '1', text: 'Per FAR 15.403-4' })).title)
      .toBe('Per FAR 15.403-4');
  });

  /**
   * THE FALLBACK IS THE POINT. A node with no text at all still needs a name, and the whole defect
   * was that the name it got was the raw token. It must be a noun a person would write.
   */
  it('a node with no text falls back to a HUMAN noun, not the raw type', () => {
    for (const t of ['bulleted_list', 'numbered_list', 'image', 'url', 'caption', 'footnote']) {
      const { title } = nodeLabel(node(t, {}));
      expect(title, `${t} fell back to its raw type`).not.toBe(t);
      expect(title, `${t} produced a snake_case title`).not.toMatch(/^[a-z]+(_[a-z]+)+$/);
      expect(title.length, `${t} produced an empty title`).toBeGreaterThan(0);
    }
  });

  it('an UNKNOWN node type is still humanised rather than passed through', () => {
    // The map cannot enumerate every future node type, so the general path has to hold too —
    // otherwise this fix expires the next time the canvas grows a primitive.
    const { title } = nodeLabel(node('pull_quote', {}));
    expect(title).toBe('Pull quote');
  });

  it('the three pre-existing cases are unchanged', () => {
    expect(nodeLabel(node('heading', { text: 'Technical Approach' })).title).toBe('Technical Approach');
    expect(nodeLabel(node('text_block', { text: 'We propose a two-phase effort.' })).title)
      .toBe('We propose a two-phase effort.');
    expect(nodeLabel(node('table', { sheet_name: 'Budget' })).title).toBe('Budget');
    // And their own empty-content fallbacks, which were already human words.
    expect(nodeLabel(node('heading', {})).title).toBe('Heading');
    expect(nodeLabel(node('text_block', {})).title).toBe('Text');
    expect(nodeLabel(node('table', {})).title).toBe('Table');
  });

  it('a title is a label, not the whole content — it is capped', () => {
    const long = 'x'.repeat(500);
    expect(nodeLabel(node('bulleted_list', { items: [{ text: long }] })).title.length).toBe(60);
  });
});
