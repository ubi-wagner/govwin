/**
 * DSIP full-proposal deconstruct — segmenter contract (lib/library/dsip-deconstruct.ts).
 *
 * Locks: (1) a 5-volume DSIP merge segments into 5 ordered, cited segments; (2) prose
 * mentions of "Volume N" never create boundaries (line-anchored + short-line guard);
 * (3) repeated page-furniture volume labels don't fragment a volume (first sighting per
 * number wins); (4) auto-detection is strict (3+ volumes incl. Technical) while a
 * DECLARED past proposal needs only 2; (5) offsets map blocks to their volume.
 */
import { describe, expect, it } from 'vitest';
import { detectDsipProposal, volumeOfOffset, detectDsipFromBlocks, volumeOfBlock } from '@/lib/library/dsip-deconstruct';

const FIVE_VOL = [
  'Aerivio Inc. — SBIR Phase I Proposal Package',
  '',
  'Volume 1',
  'Proposal Cover Sheet',
  'Firm: Aerivio Inc. DUNS 123456789 topic N251-042.',
  '',
  'Volume 2 — Technical Volume',
  'Our approach as described in Volume 3 of this proposal is priced conservatively.',
  'We integrate cUAS payloads on Group-2 airframes across contested RF environments.',
  '',
  'Volume 3: Cost Volume',
  'Direct labor totals $91,500 across the base period with overhead applied at 40%.',
  '',
  'Volume 4',
  'Company Commercialization Report',
  'No prior Phase III revenue reported; commercialization strategy targets primes.',
  '',
  'Volume 5 — Supporting Documents',
  'Letters of support from PMA-263 and AFWERX are attached herein.',
].join('\n');

describe('detectDsipProposal', () => {
  it('segments a five-volume DSIP merge, in order, with marker citations', () => {
    const d = detectDsipProposal(FIVE_VOL);
    expect(d.isDsipProposal).toBe(true);
    expect(d.segments.map((s) => s.volumeNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(d.segments[1].volKey).toBe('technical');
    expect(d.segments[2].volKey).toBe('cost');
    expect(d.segments[3].volKey).toBe('commercialization');
    expect(d.segments[0].markerExcerpt).toBe('Volume 1');
    // Boundaries: each segment ends where the next begins; last runs to EOF.
    for (let i = 0; i < d.segments.length - 1; i++) {
      expect(d.segments[i].endOffset).toBe(d.segments[i + 1].startOffset);
    }
    expect(d.segments[4].endOffset).toBe(FIVE_VOL.length);
    // The V3 slice contains the cost text, not the technical text.
    const v3 = FIVE_VOL.slice(d.segments[2].startOffset, d.segments[2].endOffset);
    expect(v3).toContain('Direct labor');
    expect(v3).not.toContain('Group-2 airframes');
  });

  it('a prose mention of "Volume 3" mid-line is NOT a boundary', () => {
    const d = detectDsipProposal(FIVE_VOL);
    // The prose reference sits inside Volume 2's segment — Volume 3 starts at the real marker.
    const proseAt = FIVE_VOL.indexOf('as described in Volume 3');
    expect(volumeOfOffset(d.segments, proseAt)?.volumeNumber).toBe(2);
  });

  it('repeated page-furniture labels do not fragment a volume (first sighting wins)', () => {
    const text = [
      'Volume 2 — Technical Volume', 'Technical content page one.',
      'Volume 2', 'Technical content page two.',
      'Volume 3: Cost Volume', 'Cost content.',
      'Volume 2', 'A stray trailing footer label.',
      'Volume 5 — Supporting Documents', 'Attachments.',
    ].join('\n');
    const d = detectDsipProposal(text, { declared: true });
    expect(d.segments.map((s) => s.volumeNumber)).toEqual([2, 3, 5]);
    // Volume 2 spans up to the Volume 3 marker despite its repeated labels.
    expect(text.slice(d.segments[0].startOffset, d.segments[0].endOffset)).toContain('page two');
  });

  it('auto-detection is strict: two volumes without a declaration is NOT a proposal — declared it is', () => {
    const twoVol = ['Volume 2 — Technical Volume', 'Approach text.', 'Volume 3: Cost Volume', 'Price text.'].join('\n');
    expect(detectDsipProposal(twoVol).isDsipProposal).toBe(false);
    expect(detectDsipProposal(twoVol, { declared: true }).isDsipProposal).toBe(true);
    // And 3+ volumes MISSING the Technical Volume still fails auto (whitepaper guard).
    const noTech = ['Volume 1', 'Cover.', 'Volume 4', 'Commercialization Report text.', 'Volume 5 — Supporting Documents', 'Letters.'].join('\n');
    expect(detectDsipProposal(noTech).isDsipProposal).toBe(false);
  });

  it('an ordinary whitepaper detects nothing', () => {
    const wp = ['Advanced cUAS Whitepaper', 'Our system reduces engagement volume by 3x.', 'Conclusions follow.'].join('\n');
    const d = detectDsipProposal(wp);
    expect(d.isDsipProposal).toBe(false);
    expect(d.segments).toEqual([]);
  });

  it('named-only separators (no numbers) still map to their volumes when declared', () => {
    const named = [
      'Proposal Cover Sheet', 'Firm data.',
      'Technical Volume', 'Approach.',
      'Cost Proposal', 'Pricing.',
    ].join('\n');
    const d = detectDsipProposal(named, { declared: true });
    expect(d.segments.map((s) => s.volumeNumber)).toEqual([1, 2, 3]);
  });

  it('volumeOfOffset: front matter before the first marker belongs to no volume', () => {
    const d = detectDsipProposal(FIVE_VOL);
    expect(volumeOfOffset(d.segments, 0)).toBeNull();
    expect(volumeOfOffset(d.segments, FIVE_VOL.length - 1)?.volumeNumber).toBe(5);
  });
});

describe('detectDsipFromBlocks (the atomizer path)', () => {
  // The reader SPACE-joins a block's node texts, so a marker survives only as the block's
  // HEADING or as a short standalone block — exactly what this mode matches. (Char-level
  // line anchoring would miss every heading-carried marker; this is the regression lock.)
  const BLOCKS = [
    { heading: null, text: 'Aerivio Inc. — SBIR Phase I Proposal Package prepared for DSIP submission.' },
    { heading: 'Volume 1', text: 'Volume 1 Firm: Aerivio Inc. DUNS 123456789 topic N251-042 certification data.' },
    { heading: 'Volume 2 — Technical Volume', text: 'Volume 2 — Technical Volume We integrate cUAS payloads on Group-2 airframes across contested RF environments as described in Volume 3 of this proposal.' },
    { heading: null, text: 'Additional technical detail: our modular mission computer hosts third-party autonomy.' },
    { heading: 'Volume 3: Cost Volume', text: 'Volume 3: Cost Volume Direct labor totals $91,500 across the base period with overhead applied at 40%.' },
    { heading: null, text: 'Volume 4' },  // heading-less separator page → short standalone block
    { heading: null, text: 'No prior Phase III revenue reported; commercialization strategy targets primes and mission partners.' },
    { heading: 'Volume 5 — Supporting Documents', text: 'Volume 5 — Supporting Documents Letters of support from PMA-263 and AFWERX are attached herein.' },
  ];

  it('segments across heading-carried AND standalone-block markers', () => {
    const d = detectDsipFromBlocks(BLOCKS);
    expect(d.isDsipProposal).toBe(true);
    expect(d.segments.map((s) => s.volumeNumber)).toEqual([1, 2, 3, 4, 5]);
    expect(d.segments.map((s) => s.blockStart)).toEqual([1, 2, 4, 5, 7]);
    // Front matter (block 0) belongs to no volume; the follow-on technical block maps to V2.
    expect(volumeOfBlock(d.segments, 0)).toBeNull();
    expect(volumeOfBlock(d.segments, 3)?.volumeNumber).toBe(2);
    expect(volumeOfBlock(d.segments, 6)?.volumeNumber).toBe(4);
  });

  it('a long space-joined block whose text merely CONTAINS a volume phrase is not a marker', () => {
    const d = detectDsipFromBlocks(BLOCKS);
    // Block 2's text contains "Volume 3 of this proposal" — V3 must anchor at block 4, not 2.
    expect(d.segments.find((s) => s.volumeNumber === 3)?.blockStart).toBe(4);
  });

  it('auto vs declared thresholds match text mode', () => {
    const two = [
      { heading: 'Volume 2 — Technical Volume', text: 'Approach text with enough words to matter here.' },
      { heading: 'Volume 3: Cost Volume', text: 'Pricing text with enough words to matter here.' },
    ];
    expect(detectDsipFromBlocks(two).isDsipProposal).toBe(false);
    expect(detectDsipFromBlocks(two, { declared: true }).isDsipProposal).toBe(true);
  });
});
