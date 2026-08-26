/**
 * getNodeText must cover every TEXT-BEARING node type.
 *
 * Its contract says "extract plain text from any node type (for search + page estimation)", and it
 * covered eight of twenty-two. callout, blockquote and code_block fell through to `default: ''`,
 * which under-counted in three places at once:
 *   · the PAGE RULER measured them as one empty line — a callout holding two lines of prose read
 *     15pt against the 31pt the same words cost in a text_block
 *   · countCharacters omitted them from the agency character cap (98 chars reported for three
 *     nodes carrying 306)
 *   · search could not find their text
 *
 * Under-count is the one direction the size gates forbid: it clears a volume that is over its
 * agency page limit. Latent until markdown_to_canvas learned to emit callouts; live the moment AI
 * drafts began carrying them.
 *
 * The assertion is comparative, not a golden number: a text-bearing node holding the same words as
 * a text_block must extract the same text and measure the same height. That stays true as the
 * calibration moves.
 */
import { describe, it, expect } from 'vitest';
import { getNodeText, nodeHeightsPt, countCharacters, CANVAS_PRESETS,
  type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';

const TXT = 'Two mandatory requirements are traced to this section and each is answered above '
  + 'in the narrative, with the supporting evidence cited inline.';

const mk = (type: string, content: Record<string, unknown>) =>
  ({ id: `n-${type}`, type, content } as unknown as CanvasNode);

/** Every type that carries prose a reader sees, and where that prose lives. */
const TEXT_BEARING: Array<[string, Record<string, unknown>]> = [
  ['text_block', { text: TXT }],
  ['heading', { level: 2, text: TXT }],
  ['blockquote', { text: TXT }],
  ['callout', { variant: 'warning', text: TXT }],
  ['code_block', { code: TXT }],
  ['caption', { prefix: 'Figure', number: 1, text: TXT }],
  ['footnote', { marker: '1', text: TXT }],
];

describe('getNodeText covers every text-bearing node type', () => {
  it.each(TEXT_BEARING)('%s yields its text', (type, content) => {
    expect(getNodeText(mk(type, content))).toContain(TXT.slice(0, 40));
  });

  it('a callout including a title yields both title and body', () => {
    const t = getNodeText(mk('callout', { variant: 'note', title: 'Mandatory', text: TXT }));
    expect(t).toContain('Mandatory');
    expect(t).toContain(TXT.slice(0, 40));
  });

  it('genuinely text-free types still yield nothing', () => {
    for (const type of ['divider', 'page_break', 'spacer', 'image']) {
      expect(getNodeText(mk(type, { storage_key: 'k', alt_text: 'a' }))).toBe('');
    }
  });
});

describe('the ruler measures text-bearing nodes by their text', () => {
  const doc = (n: CanvasNode) => ({
    version: 2, document_id: 't', canvas: CANVAS_PRESETS.letter_standard, nodes: [n],
  } as unknown as CanvasDocument);
  const h = (n: CanvasNode) => nodeHeightsPt(doc(n))[0].heightPt;

  it('a callout holding a paragraph is as tall as that paragraph', () => {
    // The exact regression: callout measured one empty line while text_block measured two.
    expect(h(mk('callout', { variant: 'warning', text: TXT })))
      .toBeGreaterThanOrEqual(h(mk('text_block', { text: TXT })));
  });

  it('a blockquote holding a paragraph is as tall as that paragraph', () => {
    expect(h(mk('blockquote', { text: TXT }))).toBeGreaterThanOrEqual(h(mk('text_block', { text: TXT })));
  });

  it('never measures a text-bearing node as an empty line', () => {
    const oneLine = h(mk('text_block', { text: 'x' }));
    for (const [type, content] of TEXT_BEARING) {
      expect(h(mk(type, content)), `${type} measured as a single empty line`).toBeGreaterThan(oneLine);
    }
  });
});

describe('countCharacters counts every text-bearing node', () => {
  it('three nodes carrying the same paragraph count roughly triple one', () => {
    const one = countCharacters([mk('text_block', { text: TXT })]);
    const three = countCharacters([
      mk('callout', { variant: 'warning', text: TXT }),
      mk('blockquote', { text: TXT }),
      mk('text_block', { text: TXT }),
    ]);
    expect(three).toBeGreaterThan(one * 2.5);
  });
});
