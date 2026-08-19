/**
 * A proposal must cite its OWN solicitation and no other.
 *
 * The leak is structural, not careless. A company's library is built from its past proposals, and
 * a past proposal's cover sheet and cost form legitimately carry that solicitation's numbers —
 * that IS the content of those pages, so it cannot be stripped at ingest. Drafting grounds on
 * those pages and carries the numbers across. Observed on the T3CP build: a cost section for
 * OSW26BZ04-DP013 opened "STTR Phase II Proposal Proposal Number F2-17528 Topic Number
 * AFX23D-TCSO1" — a different agency, a different program, three years earlier.
 */
import { describe, it, expect } from 'vitest';
import {
  validateCanvasAgainstSpec,
  findLabelledIdentifiers,
  type CanvasDocument,
  type ComplianceSpec,
} from '@/lib/types/canvas-document';
import { buildArtifactSpecs } from '@/lib/artifact-spec';

const SPEC = (own?: string[]): ComplianceSpec => ({
  max_pages: null, max_slides: null, min_font_size: null, images_allowed: true,
  required_sections: [], header_required: false, footer_required: false,
  ...(own ? { own_identifiers: own } : {}),
});

const doc = (...texts: string[]): CanvasDocument => ({
  version: 1,
  document_id: 'd',
  canvas: { width: 612, height: 792, format: 'letter', margins: { top: 72, left: 72, right: 72, bottom: 72 },
            font_default: { family: 'Times New Roman', size: 11 }, line_spacing: 1,
            images_allowed: true, max_pages: null, max_slides: null, min_font_size: null,
            header: null, footer: null },
  nodes: texts.map((t, i) => ({
    id: `n${i}`, type: 'text_block', content: { text: t }, style: {},
    provenance: { source: 'ai_draft' }, history: [], library_eligible: true,
  })),
  metadata: {},
} as unknown as CanvasDocument);

const codes = (d: CanvasDocument, s: ComplianceSpec) => validateCanvasAgainstSpec(d, s).map((v) => v.code);

describe('findLabelledIdentifiers', () => {
  it('finds the labelled forms these actually leak in', () => {
    const found = findLabelledIdentifiers(
      'STTR Phase II Proposal Proposal Number F2-17528 Topic Number AFX23D-TCSO1 '
      + 'Topic: X23.5_CSO Solicitation No. N254-P01',
    );
    expect(found).toContain('F2-17528');
    expect(found).toContain('AFX23D-TCSO1');
    expect(found).toContain('X23.5_CSO');
    expect(found).toContain('N254-P01');
  });

  it('leaves a prior CONTRACT number alone — that is past performance, not a wrong solicitation', () => {
    // Verbatim from the Immobileyes cover sheet. Including `contract`/`award` in the label set
    // flagged this real Air Force contract as though the proposal were for the wrong program.
    const text = 'Counter-UAS Disrupter for Air Force Rapid Tactical & Security Operations '
      + 'Contract # - FA864923P0971 Start Date - May 5, 2023';
    expect(findLabelledIdentifiers(text)).toEqual([]);
  });

  it('leaves an award number alone for the same reason', () => {
    expect(findLabelledIdentifiers('Delivered under Award No. W911NF2110234 in FY22.')).toEqual([]);
  });

  it('ignores a label followed by ordinary words', () => {
    // "Proposal Title", "Topic Areas" — a token with no digit is prose, not an identifier.
    expect(findLabelledIdentifiers('Proposal Title: Innovative Counter-UAS Topic Areas covered')).toEqual([]);
  });

  it('does not sweep up part or model numbers from the company’s own prose', () => {
    // Shape-matching would flag these; keying on the LABEL does not.
    const text = 'The AN/PVS-14 sensor and the FLIR-A700 camera were bench-tested at 400 m.';
    expect(findLabelledIdentifiers(text)).toEqual([]);
  });

  it('finds an identifier after a bare colon label', () => {
    expect(findLabelledIdentifiers('Topic: OSW26BZ04-DP013')).toContain('OSW26BZ04-DP013');
  });
});

describe('foreign_solicitation', () => {
  const OWN = ['OSW26BZ04-DP013', 'DoD SBIR 26.B'];

  it('flags the exact leak seen on the T3CP build', () => {
    const d = doc('STTR Phase II Proposal Proposal Number F2-17528 Topic Number AFX23D-TCSO1 Proposal Title Innovative Directed Energy');
    const violations = validateCanvasAgainstSpec(d, SPEC(OWN));
    const v = violations.find((x) => x.code === 'foreign_solicitation');
    expect(v).toBeTruthy();
    expect(v!.found).toEqual(expect.arrayContaining(['F2-17528', 'AFX23D-TCSO1']));
    expect(v!.message).toContain('OSW26BZ04-DP013');
  });

  it('passes a document citing only its own topic number', () => {
    const d = doc('This proposal responds to Topic Number OSW26BZ04-DP013 under the DoD SBIR program.');
    expect(codes(d, SPEC(OWN))).not.toContain('foreign_solicitation');
  });

  it('matches its own identifier despite case and separators', () => {
    // The same number is written differently in different places — lowercase in prose, with or
    // without the hyphen on a form. All are OUR number and none is a foreign citation.
    for (const written of ['osw26bz04-dp013', 'OSW26BZ04DP013', 'OSW26BZ04/DP013']) {
      const d = doc(`This proposal responds to Topic Number ${written} under the DoD SBIR program.`);
      expect(codes(d, SPEC(OWN)), written).not.toContain('foreign_solicitation');
    }
  });

  it('does not catch a letter-spaced identifier — a known limit, not a silent pass', () => {
    // DSIP cover sheets sometimes render the number letter-spaced ("F 2 - 1 7 5 2 8"). The label
    // regex reads a contiguous token, so this form is not detected. Recorded so the gap is visible
    // rather than mistaken for coverage.
    const found = findLabelledIdentifiers('Proposal Number: F 2 - 1 7 5 2 8');
    expect(found).toEqual([]);
  });

  it('is OFF when the build records no identifiers', () => {
    const d = doc('Proposal Number F2-17528 Topic Number AFX23D-TCSO1');
    expect(codes(d, SPEC())).not.toContain('foreign_solicitation');
    expect(codes(d, SPEC([]))).not.toContain('foreign_solicitation');
  });

  it('an empty-string identifier never becomes a wildcard', () => {
    const d = doc('Proposal Number F2-17528');
    // A blank own-identifier must not normalize to "" and match every token.
    expect(codes(d, SPEC(['', '  ']))).not.toContain('foreign_solicitation');
  });

  it('reports each distinct foreign identifier once', () => {
    const d = doc(
      'Topic Number AFX23D-TCSO1 appears here.',
      'And again: Topic Number AFX23D-TCSO1 plus Proposal Number F2-17528.',
    );
    const v = validateCanvasAgainstSpec(d, SPEC(OWN)).find((x) => x.code === 'foreign_solicitation');
    expect(v!.found).toHaveLength(2);
    expect(v!.actual).toBe(2);
  });

  it('does not fire on a clean cost narrative', () => {
    const d = doc(
      'Total direct labor for the base period is $92,400 across four labor categories.',
      'Indirect rates are applied as a value-added G&A base per the company’s DCAA-reviewed structure.',
    );
    expect(codes(d, SPEC(OWN))).not.toContain('foreign_solicitation');
  });
});

describe('the spec carries the identifiers forward', () => {
  const compliance = { fontFamily: 'Times New Roman', fontSizePt: 11 };

  it('freezes own_identifiers onto the artifact spec', () => {
    const { complianceSpec } = buildArtifactSpecs({
      artifactType: 'narrative', items: [], compliance,
      ownIdentifiers: ['OSW26BZ04-DP013', 'DoD SBIR 26.B'],
    });
    expect(complianceSpec.own_identifiers).toEqual(['OSW26BZ04-DP013', 'DoD SBIR 26.B']);
  });

  it('drops blanks and duplicates rather than freezing a wildcard', () => {
    const { complianceSpec } = buildArtifactSpecs({
      artifactType: 'narrative', items: [], compliance,
      ownIdentifiers: ['OSW26BZ04-DP013', null, '  ', 'OSW26BZ04-DP013', undefined],
    });
    expect(complianceSpec.own_identifiers).toEqual(['OSW26BZ04-DP013']);
  });

  it('omits the field entirely when nothing usable is supplied, leaving the check off', () => {
    const { complianceSpec } = buildArtifactSpecs({
      artifactType: 'narrative', items: [], compliance, ownIdentifiers: [null, ''],
    });
    expect(complianceSpec.own_identifiers).toBeUndefined();
  });
});
