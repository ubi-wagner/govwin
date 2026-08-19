/**
 * Running page furniture must never reach a library atom.
 *
 * The bug these lock: a past proposal atomized at page grain kept each page's repeated footer, so
 * every atom carried the SOURCE solicitation's identifiers. A T3CP technical section (topic
 * OSW26BZ04-DP013) was then drafted citing "Topic: X23.5_CSO Proposal Number: FX235-CSO1-0859" —
 * a different agency's topic from two years earlier, welded into the library as if it were the
 * company's own prose.
 */
import { describe, it, expect } from 'vitest';
import {
  detectRunningFurniture,
  stripFurniture,
  stripDocumentFurniture,
} from '@/lib/library/page-furniture';

/** The real shape: a repeated footer carrying another solicitation's identifiers, plus page numbers. */
const FOOTER = 'Topic: X23.5_CSO        Proposal Number: FX235-CSO1-0859';
const page = (n: number, body: string) => `${body}\n${n}\n${FOOTER}`;

const DOC = [
  page(1, 'Small Business Innovation Research (SBIR) Program - Proposal Cover Sheet\nFirm: Immobileyes Inc.'),
  page(2, 'Identification and Significance of the Problem\nFPV fiber-optic drones defeat RF-based defeat systems.'),
  page(3, 'Phase I Technical Objectives\nDemonstrate acoustic-plus-EO cueing at 400 m against a fiber drone.'),
  page(4, 'Related Work\nPrior HALAR work established the optical tracking chain.'),
  page(5, 'Commercialization Strategy\nBase security and critical-infrastructure operators are the first market.'),
];

describe('detectRunningFurniture', () => {
  it('finds the footer repeated across the document', () => {
    const f = detectRunningFurniture(DOC);
    expect(f.has('topic: x#.#_cso proposal number: fx#-cso#-#')).toBe(true);
  });

  it('does not treat a one-page line as furniture', () => {
    const f = detectRunningFurniture(DOC);
    expect(f.has('related work')).toBe(false);
    expect(f.has('phase i technical objectives')).toBe(false);
  });

  it('refuses to guess from too few pages', () => {
    // Two pages sharing a line is coincidence, not a running header.
    expect(detectRunningFurniture([page(1, 'Alpha'), page(2, 'Beta')]).size).toBe(0);
  });

  it('ignores long repeated passages — those are content the company chose to repeat', () => {
    const boiler = 'X'.repeat(400);
    const pages = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((h) => `${h}\n${boiler}`);
    expect(detectRunningFurniture(pages).size).toBe(0);
  });

  it('does not strip numbered captions in the page body', () => {
    // Digit collapsing makes "Table 1" … "Table 5" one key, so without the edge rule every
    // caption in the document would look like a running header and be deleted.
    // A realistic page: the caption sits well inside the body, not at either edge.
    const body = (n: number) => [
      `Section heading ${n}`,
      'Opening paragraph for this page of the technical volume.',
      'A second paragraph continuing the discussion of sensor performance.',
      'A third paragraph on the measurement methodology used in the trial.',
      `Table ${n}. Detection range by sensor modality.`,
      'A paragraph interpreting the table above against the threshold.',
      'A further paragraph on limitations observed during the trial.',
      `Unique closing remark for page ${n} of the volume.`,
    ].join('\n');
    const pages = [1, 2, 3, 4, 5].map((n) => body(n));
    const f = detectRunningFurniture(pages);
    expect(f.has('table #. detection range by sensor modality.')).toBe(false);
    expect(stripFurniture(pages[2], f)).toContain('Table 3. Detection range');
  });

  it('counts a line once per page, so one page repeating a phrase cannot fake furniture', () => {
    const pages = [
      'dup\ndup\ndup\ndup\ndup\ndup\nreal body one',
      'real body two', 'real body three', 'real body four', 'real body five',
    ];
    expect(detectRunningFurniture(pages).has('dup')).toBe(false);
  });
});

describe('stripFurniture', () => {
  it('removes the running footer but keeps the page body', () => {
    const f = detectRunningFurniture(DOC);
    const out = stripFurniture(DOC[1], f);
    expect(out).toContain('FPV fiber-optic drones');
    expect(out).not.toContain('FX235-CSO1-0859');
    expect(out).not.toContain('X23.5_CSO');
  });

  it('removes bare page numbers without a repetition signal', () => {
    expect(stripFurniture('Body text here\n7', new Set())).toBe('Body text here');
    expect(stripFurniture('Body text here\nPage 7 of 15', new Set())).toBe('Body text here');
  });

  it('does not remove a number that is part of a sentence', () => {
    const out = stripFurniture('We flew 7 sorties against the target.', new Set());
    expect(out).toBe('We flew 7 sorties against the target.');
  });

  it('is a no-op on empty input', () => {
    expect(stripFurniture('', new Set())).toBe('');
  });
});

describe('stripDocumentFurniture', () => {
  it('cleans every page and reports what it removed', () => {
    const { pages, furniture, removedChars } = stripDocumentFurniture(DOC);
    for (const p of pages) {
      expect(p).not.toContain('FX235-CSO1-0859');
    }
    // Reported in its ORIGINAL form — "topic: x#.#_cso" is not something a human recognizes.
    expect(furniture.some((f) => f.includes('FX235-CSO1-0859'))).toBe(true);
    expect(removedChars).toBeGreaterThan(0);
  });

  it('keeps every page body intact', () => {
    const { pages } = stripDocumentFurniture(DOC);
    expect(pages[0]).toContain('Proposal Cover Sheet');
    expect(pages[2]).toContain('acoustic-plus-EO cueing');
    expect(pages[4]).toContain('critical-infrastructure operators');
  });

  it('passes a document with no furniture through untouched', () => {
    const clean = ['Alpha body text', 'Beta body text', 'Gamma body text', 'Delta body text', 'Epsilon body'];
    const out = stripDocumentFurniture(clean);
    expect(out.pages).toEqual(clean);
    expect(out.furniture).toEqual([]);
    expect(out.removedChars).toBe(0);
  });

  it('leaves an all-furniture page empty rather than deciding to drop it', () => {
    // The caller's own MIN_ATOM_WORDS rule decides whether a page is worth keeping.
    const pages = [...DOC, `9\n${FOOTER}`];
    const out = stripDocumentFurniture(pages);
    expect(out.pages[5]).toBe('');
  });

  it('handles a document whose pages are empty strings', () => {
    expect(() => stripDocumentFurniture(['', '', '', '', ''])).not.toThrow();
  });
});
