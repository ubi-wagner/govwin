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
import { detectDsipProposal, volumeOfOffset, detectDsipFromBlocks, volumeOfBlock, detectDsipFromPages, classifyDsipSidecar } from '@/lib/library/dsip-deconstruct';

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

describe('detectDsipFromPages (real DSIP downloads) + sidecar classifier', () => {
  const P = (n: number, m: number, text: string) => `-- ${n} of ${m} -- ${text}`;
  const REAL = [
    P(1, 10, 'Small Business Innovation Research (SBIR) Program - Proposal Cover Sheet Disclaimer Knowingly and willfully'),
    P(2, 10, '121.702. 4. Verify that your firm has registered in the SBAS Company Registry at www.sbir.gov'),
    P(3, 10, 'Approach (MOSA) sensor-agnostic cueing to deliver a graduated response across every fielded configuration today.'),
    P(4, 10, 'VOL I - Contact Information Principal Investigator Name: Dr. A Alavi Phone: (330) 555-0000'),
    P(5, 10, 'Proposal Number: N26BX-NP002-0450 Open Topic Number: DON26BX03-NP002 Immobileyes, Inc. Page 1 of 3 Guided'),
    P(6, 10, 'Proposal Number: N26BX-NP002-0450 Open Topic Number: DON26BX03-NP002 Immobileyes, Inc. Page 2 of 3 STORM'),
    P(7, 10, 'SBIR Phase I Proposal Proposal Number N26BX-NP002-0450 Topic Number DON26BX03-NP002 Proposal Title Adaptive'),
    P(8, 10, 'Cost Volume Details Direct Labor Base Category Description Education Yrs Experience Hours Rate'),
    P(9, 10, 'SBIR Company Commercialization Report Privileged and confidential and not subject to disclosure'),
    P(10, 10, 'A. Alavi, Immobileyes Inc. Jul 21, 2026 Jul 21, 2027'),
  ].join('\n');

  it('segments the real anatomy: cover form → tech (Page 1 of N anchor) → cost form → CCR → remainder', () => {
    const d = detectDsipFromPages(REAL);
    expect(d.isDsipProposal).toBe(true);
    const byVol = Object.fromEntries(d.segments.map((s: { volumeNumber: number }) => [s.volumeNumber, s]));
    expect(byVol[1].pageStart).toBe(1); expect(byVol[1].pageEnd).toBe(4);
    expect(byVol[2].pageStart).toBe(5); expect(byVol[2].pageEnd).toBe(6); expect(byVol[2].inferred).toBe(false);
    expect(byVol[3].pageStart).toBe(7); expect(byVol[3].pageEnd).toBe(8);
    expect(byVol[4].pageStart).toBe(9); expect(byVol[4].pageEnd).toBe(9);
    expect(byVol[5].pageStart).toBe(10); expect(byVol[5].inferred).toBe(true);
  });

  it('slide-deck tech volume with NO page furniture: V2 boundary is INFERRED after the last form page', () => {
    const CSO = [
      P(1, 6, 'Small Business Innovation Research(SBIR) Program - Proposal Cover Sheet Disclaimer text here'),
      P(2, 6, 'Recombinant DNA of the solicitation: 13. In accordance with Federal Acquisition Regulation 4.2105'),
      P(3, 6, 'Introduction and Summary: Counter-UAS and Defeat of Drone Surveillance Company Name Immobileyes'),
      P(4, 6, 'SBIR Phase I Proposal Proposal Number FX235-CSO1-0859 Topic Number AFX235-CSO1 Proposal Title Base-Wide'),
      P(5, 6, 'SBIR Company Commercialization Report IMMOBILEYES INC DISCLAIMER: Information provided herein'),
      P(6, 6, 'A. Alavi, Immobileyes Inc. Feb 22, 2023 Feb 22, 2024'),
    ].join('\n');
    const d = detectDsipFromPages(CSO);
    expect(d.isDsipProposal).toBe(true);
    const v2 = d.segments.find((s: { volumeNumber: number }) => s.volumeNumber === 2)!;
    expect(v2.pageStart).toBe(3);
    expect(v2.inferred).toBe(true);
    expect(v2.markerExcerpt).toContain('inferred');
  });

  it('a non-DSIP paged PDF (no cost form / CCR anchors) detects nothing', () => {
    const wp = [P(1, 3, 'Whitepaper on lasers'), P(2, 3, 'More prose here'), P(3, 3, 'Conclusions')].join('\n');
    expect(detectDsipFromPages(wp).isDsipProposal).toBe(false);
  });

  it('classifies the full DSIP sidecar taxonomy', () => {
    expect(classifyDsipSidecar('x-N26BXNP0020450_Full_Proposal.pdf')).toBeNull();
    expect(classifyDsipSidecar('a-N26BXNP0020450_SBC_748198.pdf')?.volumeNumber).toBe(1);
    expect(classifyDsipSidecar('b-N26BXNP0020450CoverSheet.pdf')?.volumeNumber).toBe(1);
    expect(classifyDsipSidecar('c-N26BXNP0020450Budget.pdf')?.volKey).toBe('cost');
    expect(classifyDsipSidecar('d-N26BXNP0020450_Addt_Cost_Info_1816592.pdf')?.volumeNumber).toBe(3);
    expect(classifyDsipSidecar('e-N26BXNP0020450CCR.pdf')?.volKey).toBe('commercialization');
    expect(classifyDsipSidecar('f-N26BXNP0020450_Fund_Agrmnt_Cert_1817601.pdf')?.volumeNumber).toBe(5);
    expect(classifyDsipSidecar('g-N26BXNP0020450_Lifecycle_Cert_1817605.pdf')?.volumeNumber).toBe(5);
    expect(classifyDsipSidecar('h-N26BXNP0020450_Other_1817608.pdf')?.volumeNumber).toBe(5);
    expect(classifyDsipSidecar('i-N26BXNP0020450Foreign_Affiliations.pdf')?.volumeNumber).toBe(5);
    expect(classifyDsipSidecar('j-N26BXNP0020450FWA.pdf')?.volumeNumber).toBe(6);
    expect(classifyDsipSidecar('k-N26BXNP0020450Proposal.pdf')?.volumeNumber).toBe(2);
  });
});
