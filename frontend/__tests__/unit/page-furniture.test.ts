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

// Volume-length, like the real thing — a running header has to head a VOLUME to be recognized,
// so a five-page fixture would not exercise the rule the real documents exercise.
const BODIES = [
  'Small Business Innovation Research (SBIR) Program - Proposal Cover Sheet\nFirm: Immobileyes Inc.',
  'Identification and Significance of the Problem\nFPV fiber-optic drones defeat RF-based defeat systems.',
  'Phase I Technical Objectives\nDemonstrate acoustic-plus-EO cueing at 400 m against a fiber drone.',
  'Related Work\nPrior HALAR work established the optical tracking chain.',
  'Commercialization Strategy\nBase security and critical-infrastructure operators are the first market.',
  'Key Personnel\nAtossa Alavi serves as Principal Investigator for the effort.',
  'Facilities and Equipment\nThe Kent optics laboratory hosts the breadboard range.',
  'Foreign Citizens\nNo foreign nationals are proposed for work under this effort.',
  'Subcontractors and Consultants\nAlphaMicron supports the optical film development.',
  'Prior Support\nNo essentially equivalent work has been submitted elsewhere.',
  'Data Rights Assertions\nLimited rights are asserted on the beam-routing control software.',
  'Letters of Support\nThe Air Force Security Forces Center provided a letter of support.',
];
const DOC = BODIES.map((b, i) => page(i + 1, b));

describe('detectRunningFurniture', () => {
  it('finds the footer repeated across the document', () => {
    const f = detectRunningFurniture(DOC);
    expect(f.has('topic: x23.5_cso proposal number: fx235-cso1-0859')).toBe(true);
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
    const pages = Array.from({ length: 12 }, (_, i) => `Heading ${i}\n${boiler}`);
    expect(detectRunningFurniture(pages).size).toBe(0);
  });

  it('does not strip numbered captions in the page body', () => {
    // Captions differ verbatim, so they never share a furniture key. This is why digit collapsing
    // is confined to lines that carry page numbering: applied to every line, "Table 1" … "Table 5"
    // would collapse to one key, look repeated, and be deleted from the body of every page.
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
    const pages = Array.from({ length: 12 }, (_, i) => body(i + 1));
    const f = detectRunningFurniture(pages);
    expect(f.has('table 3. detection range by sensor modality.')).toBe(false);
    expect(stripFurniture(pages[2], f)).toContain('Table 3. Detection range');
  });

  it('counts a line once per page, so one page repeating a phrase cannot fake furniture', () => {
    const pages = [
      'a repeated phrase\na repeated phrase\na repeated phrase\na repeated phrase\nreal body one',
      ...Array.from({ length: 11 }, (_, i) => `real body ${i + 2} with its own distinct wording`),
    ];
    expect(detectRunningFurniture(pages).has('a repeated phrase')).toBe(false);
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
    // Reported in its ORIGINAL form — a lowercased/collapsed key is not something a human
    // recognizes as the footer they are looking at.
    expect(furniture.some((f) => f.includes('FX235-CSO1-0859'))).toBe(true);
    expect(removedChars).toBeGreaterThan(0);
  });

  it('does not list bare page numbers in the report', () => {
    // They are removed unconditionally; enumerating "Page 1 of 15" … "Page 15 of 15" would bury
    // the one or two lines a curator actually needs to check.
    const pages = Array.from({ length: 12 }, (_, i) =>
      `Body text for page ${i} of this volume.\nRunning Header With Identifiers 12345\nPage ${i + 1} of 12`);
    const out = stripDocumentFurniture(pages);
    expect(out.furniture).toEqual(['Running Header With Identifiers 12345']);
    for (const p of out.pages) expect(p).not.toMatch(/Page \d+ of 12/);
  });

  it('keeps every page body intact', () => {
    const { pages } = stripDocumentFurniture(DOC);
    expect(pages[0]).toContain('Proposal Cover Sheet');
    expect(pages[2]).toContain('acoustic-plus-EO cueing');
    expect(pages[4]).toContain('critical-infrastructure operators');
  });

  it('passes a document with no furniture through untouched', () => {
    const clean = Array.from({ length: 12 }, (_, i) => `Distinct body text for page ${i} of the volume`);
    const out = stripDocumentFurniture(clean);
    expect(out.pages).toEqual(clean);
    expect(out.furniture).toEqual([]);
    expect(out.removedChars).toBe(0);
  });

  it('leaves an all-furniture page empty rather than deciding to drop it', () => {
    // The caller's own MIN_ATOM_WORDS rule decides whether a page is worth keeping.
    const pages = [...DOC, `99\n${FOOTER}`];
    const out = stripDocumentFurniture(pages);
    expect(out.pages[DOC.length]).toBe('');
  });

  it('handles a document whose pages are empty strings', () => {
    expect(() => stripDocumentFurniture(Array.from({ length: 12 }, () => ''))).not.toThrow();
  });
});

describe('page-number collapsing is confined to lines that ARE page numbering', () => {
  /**
   * Digit collapsing is what recognizes "Page 3 of 15" and "Page 4 of 15" as one footer. Applied
   * to any line that merely CONTAINS a page reference, it becomes destructive: a body sentence
   * citing a page collapses to the same key on every page of a run, gets confirmed as furniture,
   * and variant expansion then deletes each individual sentence — real prose, silently gone.
   */
  it('keeps prose that cites a page number', () => {
    const pages = Array.from({ length: 10 }, (_, i) =>
      `The full task schedule continued on page ${i} of the attachment for review.`);
    const out = stripDocumentFurniture(pages);
    for (let i = 0; i < pages.length; i++) expect(out.pages[i]).toBe(pages[i]);
  });

  it('still collapses a real footer that carries a little text beside the number', () => {
    const pages = Array.from({ length: 10 }, (_, i) =>
      `Volume body paragraph number ${i} with its own distinct wording.\nImmobileyes Inc. Page ${i + 1} of 10`);
    const out = stripDocumentFurniture(pages);
    for (const p of out.pages) expect(p).not.toContain('Immobileyes Inc. Page');
    expect(out.pages[3]).toContain('Volume body paragraph number 3');
  });
});

describe('a run is measured against its own span, not the whole document', () => {
  /**
   * A merged DSIP submission is several documents concatenated: the technical volume carries one
   * header, the cost volume another, the cover sheet none. Measured against the whole file, a
   * header running through all 10 pages of a 32-page package covers 31% and falls under any sane
   * threshold — while within the volume it actually heads, it covers 100%. That is exactly what
   * let the DON26BX header through into a new proposal's Statement of Work.
   */
  const HDR = 'Proposal Number: N26BX-NP002-0450';
  const merged = [
    ...Array.from({ length: 8 }, (_, i) => `Cover sheet and certifications page ${i} body text.`),
    ...Array.from({ length: 10 }, (_, i) => `${HDR}\nTechnical volume page ${i} discussing the approach.`),
    ...Array.from({ length: 6 }, (_, i) => `Cost volume page ${i} with the budget narrative.`),
  ];

  it('strips a header that runs through one volume of a merged package', () => {
    const out = stripDocumentFurniture(merged);
    for (const p of out.pages) expect(p).not.toContain('N26BX-NP002-0450');
    expect(out.pages[10]).toContain('Technical volume page 2');
    expect(out.pages[0]).toContain('Cover sheet and certifications');
  });

  it('does not strip a line that recurs sparsely across the whole document', () => {
    // Same total count, but scattered — no run, so no furniture.
    const scattered = Array.from({ length: 24 }, (_, i) =>
      (i % 8 === 0 ? `${HDR}\n` : '') + `Body paragraph ${i} of the volume.`);
    const f = detectRunningFurniture(scattered);
    expect(f.has('proposal number: n26bx-np002-0450')).toBe(false);
  });

  it('does not strip a multi-page table that repeats its own labels', () => {
    // Measured on the filed F2-17528 proposal: the header and the cost form's line labels BOTH
    // appear on 100% of the pages in their run. Only the RUN LENGTH separates them — 17 pages of
    // header versus 4 pages of cost table. An aggressive density rule deleted the cost figures.
    const HDR = 'Topic Number: AFX23D-TCSO1 Proposal Number: F2-17528';
    const costLabels = 'Subcontractor Costs\nResearch Institute Costs\nTotal Direct Material Costs (TDM) $35,000.00';
    const doc = [
      ...Array.from({ length: 14 }, (_, i) => `${HDR}\nTechnical narrative page ${i} of the volume.`),
      ...Array.from({ length: 4 }, (_, i) => `Cost form continuation ${i}.\n${costLabels}`),
    ];
    const out = stripDocumentFurniture(doc);
    for (const p of out.pages) expect(p).not.toContain('F2-17528');
    for (let i = 14; i < 18; i++) {
      expect(out.pages[i]).toContain('Subcontractor Costs');
      expect(out.pages[i]).toContain('Total Direct Material Costs (TDM) $35,000.00');
    }
  });

  it('does not strip a repeated word in a table column', () => {
    // "Base" / "Option" run down a Phase I task schedule. A perfect run, but a lone token is
    // content, not a header — stripping it would take a column out of the table.
    const sched = Array.from({ length: 8 }, (_, i) =>
      `Task ${i}: system definition and feasibility assessment work.\n${i < 4 ? 'Base' : 'Option'}`);
    const out = stripDocumentFurniture(sched);
    expect(out.pages[0]).toContain('Base');
    expect(out.pages[7]).toContain('Option');
  });
});

describe('variant expansion', () => {
  /**
   * A document can carry more than one footer. On the filed FX23.5-CSO proposal the header
   * "…Proposal Number: FX235-CSO1-0859" repeats on 25 of 40 pages while "…-0853" appears on only
   * a few — the same header with a different number, below the repetition threshold on its own,
   * and left behind on exactly the pages a technical draft is most likely to ground on.
   */
  const A = 'Topic: X23.5_CSO Proposal Number: FX235-CSO1-0859';
  const B = 'Topic: X23.5_CSO Proposal Number: FX235-CSO1-0853';
  const doc = [
    ...Array.from({ length: 10 }, (_, i) => `Technical narrative page ${i} of the volume.\n${A}`),
    `Defense need body text goes here.\n${B}`,
    `Commercialization partners text.\n${B}`,
  ];

  it('sweeps up a rare variant of a confirmed furniture line', () => {
    const out = stripDocumentFurniture(doc);
    for (const p of out.pages) {
      expect(p).not.toContain('FX235-CSO1-0859');
      expect(p).not.toContain('FX235-CSO1-0853');
    }
    expect(out.pages[10]).toContain('Defense need body text');
  });

  it('never expands into a family that was never confirmed', () => {
    // No "Table N" line ever repeats verbatim, so none is confirmed, so none can be expanded to.
    const captions = Array.from({ length: 12 }, (_, i) =>
      `Body paragraph for this page of the volume.\nTable ${i + 1}. Detection range by modality.\nClosing line ${i + 1}.`);
    const out = stripDocumentFurniture(captions);
    for (let i = 0; i < captions.length; i++) {
      expect(out.pages[i]).toContain(`Table ${i + 1}. Detection range by modality.`);
    }
  });

  it('expansion requires the same shape, not merely a shared prefix', () => {
    const base = 'Report Section 1 of 4';
    const pages = [
      ...Array.from({ length: 10 }, (_, i) => `body paragraph ${i}\n${base}`),
      'final body\nA wholly different closing sentence entirely.',
    ];
    const f = detectRunningFurniture(pages);
    expect(f.has('a wholly different closing sentence entirely.')).toBe(false);
  });
});

describe('position is not a signal in extracted PDF text', () => {
  /**
   * Measured on the filed FX23.5-CSO proposal (40 pages): the SAME footer line appears at line
   * index 2 on one page and index 33 on another. A PDF's text layer comes out in content-stream
   * order, not visual order, so an "only look at the top/bottom N lines" rule found nothing at all
   * on the real file. These lock the behaviour that replaced it.
   */
  const FOOT = 'Topic: X23.5_CSO \tProposal Number: FX235-CSO1-0859';
  // `from` keeps the line numbering continuous across a page, so an assertion can name the lines
  // either side of where the footer was removed.
  const filler = (tag: string, n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => `${tag} body line ${from + i} with enough words to read as prose.`);

  // Ten pages, the footer at a different line index on each — the shape real PDF extraction gives.
  const AT = [2, 20, 33, 0, 15, 7, 28, 11, 24, 4];
  const scattered = AT.map((at, p) => {
    const tag = String.fromCharCode(97 + p);
    return [...filler(tag, at), FOOT, ...filler(tag, 34 - at, at)].join('\n');
  });

  it('finds a footer that lands at a different line index on every page', () => {
    const f = detectRunningFurniture(scattered);
    expect(f.has('topic: x23.5_cso proposal number: fx235-cso1-0859')).toBe(true);
  });

  it('removes it from mid-document, not only at the edges', () => {
    const out = stripDocumentFurniture(scattered);
    for (const p of out.pages) expect(p).not.toContain('FX235-CSO1-0859');
    // …and the surrounding prose is untouched.
    expect(out.pages[1]).toContain('b body line 19');
    expect(out.pages[1]).toContain('b body line 20');
    expect(out.pages[3]).toContain('d body line 0');
  });
});
