/**
 * The deterministic ingest extractor (`pattern_match`) — lib/ingest/pattern-extract.ts.
 *
 * The fixture below is REAL text lifted from the DoW 2026 SBIR BAA that broke this open: the
 * matrix came back byte-identical whether the shredder had extracted 0 characters or 165,268,
 * asserting a 10-page limit and Times New Roman that appear nowhere in that document, and
 * dropping its seventh volume. Every assertion here is a rule that BAA actually states — or,
 * as importantly, one it deliberately does not.
 */
import { describe, expect, it } from 'vitest';
import { extractByPattern, hasUsableSourceText } from '@/lib/ingest/pattern-extract';
import { parseSolicitation } from '@/lib/ingest/parse-solicitation';

/**
 * Verbatim excerpts from the DoW 2026 SBIR BAA, spliced with its printed "-- N of 50 --" page
 * footers so page resolution is exercised the way the live shred produces it.
 */
const BAA = `
UNLESS OTHERWISE STATED WITHIN THE TOPIC, complete proposals must be certified and submitted in
DSIP no later than 12:00p.m. ET on the close date of the release listed above.

-- 1 of 50 --

DSIP provides a structure for providing the following proposal volumes:
a. \tVolume 1: Proposal Cover Sheet
b. \tVolume 2: Technical Volume
c. \tVolume 3: Cost Volume
d. \tVolume 4: Company Commercialization Report
e. \tVolume 5: Supporting Documents
f. \tVolume 6: Fraud, Waste and Abuse Training
g. \tVolume 7: Disclosures of Foreign Affiliations or Relationships to Foreign Countries
Each Service/Component guidance on allowable proposal content may vary.

-- 2 of 50 --

2. \tLength. It is the proposing SBC's responsibility to verify that the technical volume does
not exceed the page limit after upload to DSIP. Please refer to Service/Component-specific
instructions for how a technical volume is handled if the stated page count is exceeded.
3. \tLayout. Number all proposal pages consecutively. Submit a direct, concise, and
informative research or R&D proposal (no type smaller than 10-point on standard 8-1/2" x
11" paper with one-inch margins, including the header).
c. \tTechnical Volume Content (Volume 2)
The Technical Volume should cover the following items in the order given below:
1. \tIdentification and Significance of the Problem or Opportunity
2. \tPhase I Technical Objectives
3. \tPhase I Statement of Work
4. \tRelated Work
5. \tRelationship with Future Research or Research and Development
6. \tCommercialization Strategy
7. \tKey Personnel
8. \tForeign Citizens
9. \tFacilities/Equipment
10. Subcontractors/Consultants
11. Prior, Current, or Pending Support of Similar Proposals or Awards
12. Identification and Assertion of Restrictions on the Government's Use, Release, or
Disclosure of Technical Data or Computer Software

-- 3 of 50 --

Format
The Technical Volume shall meet the following requirements:
• \tPlease refer to Service/Component-specific topic instructions for the page limit and how a
technical volume is handled if the stated page count is exceeded.
• \tSingle column format single-spaced typed lines.
• \tStandard 8 1/2" x 11" paper format.
• \tPage margins one inch on all sides. A header and footer may be included in the one-inch margin.
• \tNo font smaller than 10-point. For headers, footers, imbedded tables, figures, images, or graphics
that include text, a font size of smaller than 10-point is allowable.
Do not lock or encrypt the uploaded file. Do not include or embed active graphics such as videos,
moving pictures, or other similar media in the document.

-- 4 of 50 --
`;

describe('hasUsableSourceText', () => {
  it('rejects empty, whitespace, and stub-length text', () => {
    expect(hasUsableSourceText('')).toBe(false);
    expect(hasUsableSourceText(null)).toBe(false);
    expect(hasUsableSourceText('   \n\t  ')).toBe(false);
    expect(hasUsableSourceText('a shred that produced only a title line')).toBe(false);
  });
  it('accepts a real shred', () => {
    expect(hasUsableSourceText(BAA)).toBe(true);
  });
});

describe('extractByPattern — reads what the document states', () => {
  const r = extractByPattern(BAA);

  it('reads the minimum font size off "no type smaller than 10-point"', () => {
    expect(r.compliance.minFontSize).toBe(10);
    expect(r.evidence.min_font_size.rule).toBe('min_font.no_smaller_than');
    expect(r.evidence.min_font_size.anchor.excerpt).toMatch(/no type smaller than 10-point/i);
    expect(r.evidence.min_font_size.anchor.method).toBe('pattern_match');
  });

  it('reads the margins', () => {
    expect(r.compliance.margins).toBe('1 inch (all sides)');
  });

  it('composes submission_format ONLY from proven fragments', () => {
    expect(r.compliance.submissionFormat).toContain('8.5 x 11 in');
    expect(r.compliance.submissionFormat).toContain('single column');
    expect(r.compliance.submissionFormat).toContain('single-spaced');
    expect(r.compliance.submissionFormat).toContain('10-pt minimum font');
    // Nothing invented: this BAA mandates no typeface, so none is claimed.
    expect(r.compliance.submissionFormat).not.toMatch(/Times New Roman|Arial/i);
  });

  it('claims NO typeface — the BAA mandates none', () => {
    expect(r.compliance.fontFamily).toBeUndefined();
    expect(r.evidence.font_family).toBeUndefined();
  });

  it('finds all SEVEN DSIP volumes, including the one the default skeleton drops', () => {
    expect(r.volumes.map((v) => v.name)).toEqual([
      'Proposal Cover Sheet', 'Technical Volume', 'Cost Volume',
      'Company Commercialization Report', 'Supporting Documents',
      'Fraud, Waste and Abuse Training',
      'Disclosures of Foreign Affiliations or Relationships to Foreign Countries',
    ]);
  });

  it('reads the mandated Technical Volume section order, joining the wrapped item 12', () => {
    expect(r.compliance.requiredSections).toHaveLength(12);
    expect(r.compliance.requiredSections![0]).toBe('Identification and Significance of the Problem or Opportunity');
    expect(r.compliance.requiredSections![11]).toBe(
      "Identification and Assertion of Restrictions on the Government's Use, Release, or Disclosure of Technical Data or Computer Software",
    );
  });

  it('sets NO page limit and records the deferral — absence is the finding', () => {
    expect(r.compliance.pageLimitTechnical).toBeUndefined();
    expect(r.deferrals.map((d) => d.field)).toContain('page_limit_technical');
    expect(r.deferrals[0].reason).toMatch(/Component-specific/i);
    expect(r.notes.join(' ')).toMatch(/defers the technical-volume page limit/i);
  });

  it('surfaces the findings with no column of their own', () => {
    expect(r.notes.join(' ')).toMatch(/12:00p\.m\. ET/);
    expect(r.notes.join(' ')).toMatch(/Active graphics/i);
    expect(r.notes.join(' ')).toMatch(/must not be locked/i);
  });

  it('resolves real page numbers from the printed footers', () => {
    expect(r.evidence.volumes.pageResolved).toBe(true);
    expect(r.evidence.volumes.anchor.page).toBe(2);          // the volume list is on p.2 here
    expect(r.evidence.required_sections.anchor.page).toBe(3);
    expect(r.evidence.margins.anchor.page).toBe(4);           // the Format block
  });
});

describe('extractByPattern — refuses to guess', () => {
  it('returns nothing for text with no source', () => {
    const r = extractByPattern('');
    expect(r.hasAny).toBe(false);
    expect(r.compliance).toEqual({});
    expect(r.volumes).toEqual([]);
  });

  it('does not build a volume list from a lone cross-reference', () => {
    const text = `${'filler text. '.repeat(40)}As described in Volume 3: Cost Volume above, costs are separate.`;
    expect(extractByPattern(text).volumes).toEqual([]);
  });

  it('does not claim a page when the text has no page markers', () => {
    const text = `${'filler. '.repeat(40)} Page margins one inch on all sides for the technical volume.`;
    const r = extractByPattern(text);
    expect(r.compliance.margins).toBe('1 inch (all sides)');
    expect(r.evidence.margins.pageResolved).toBe(false);
    expect(r.notes.join(' ')).toMatch(/No page markers/i);
  });

  it('rejects an out-of-range font size rather than writing it', () => {
    const text = `${'filler. '.repeat(40)} Submit with no type smaller than 99-point on letter paper.`;
    expect(extractByPattern(text).compliance.minFontSize).toBeUndefined();
  });

  it('reads a page limit when one IS stated', () => {
    const text = `${'filler. '.repeat(40)} The Technical Volume shall not exceed 15 pages in total.`;
    const r = extractByPattern(text);
    expect(r.compliance.pageLimitTechnical).toBe(15);
    expect(r.deferrals).toEqual([]);
  });

  it('prefers the cap stated ABOUT the Technical Volume over any other page cap', () => {
    // The DoW T3CP Component instructions state three caps. Leftmost-match would pick whichever
    // happened to come first; the anchored rule picks the one that is actually the TV limit.
    const text = `${'filler. '.repeat(30)}
Phase II proposals must include the following in Volume 5:
• A summary of Phase I-equivalent work performed (not to exceed 3 pages), including results.
Technical Volume (Volume 2)
The Technical Volume is not to exceed 10 pages and must follow the formatting requirements.`;
    const r = extractByPattern(text);
    expect(r.compliance.pageLimitTechnical).toBe(10);
    expect(r.evidence.page_limit_technical.rule).toBe('page_limit.technical_volume_not_exceed');
  });

  it('does not read prose as a volume title ("…to Volume 5. For additional details…")', () => {
    const text = `${'filler. '.repeat(30)}
Do not upload any previous versions of this form to Volume 5. For additional details, please refer to the guide.
Volume 5. This sentence should not become a volume name either.`;
    expect(extractByPattern(text).volumes).toEqual([]);
  });

  it('segments page numbering across concatenated documents', () => {
    // full_text is every shredded document joined, so the numbering restarts per file.
    const two = `${BAA}\n-- 1 of 4 --\nTopic instructions.\n-- 2 of 4 --\nMore.\n-- 3 of 4 --\n`;
    const r = extractByPattern(two);
    expect(r.notes.join(' ')).toMatch(/spans 2 documents/i);
    expect(r.evidence.margins.docSegment).toBe(1);
    expect(r.evidence.margins.docSegmentPages).toBe(50);
  });
});

describe('cross-document reconciliation — the Component instructions resolve the BAA deferral', () => {
  // The real shape of a DoW ingest: the umbrella BAA plus the Component-specific instructions
  // it points at, concatenated into one full_text with page numbering restarting per document.
  const COMPONENT = `
-- 1 of 9 --
T3CP Component-Specific Instructions
Proposal Coversheet (Volume 1)
Volume 1 is created as part of the DoW Proposal Submissions process.
Technical Volume (Volume 2)
The Technical Volume is not to exceed 10 pages and must follow the formatting requirements
provided in the DoW SBIR Program BAA. T3CP will only evaluate the first ten (10) pages.
-- 2 of 9 --
Cost Volume (Volume 3)
The Phase I Base amount must not exceed $250,000.00.
-- 3 of 9 --
`;

  it('reads the page limit from the attached instructions and drops the now-stale deferral', () => {
    const r = extractByPattern(`${BAA}\n${COMPONENT}`);
    expect(r.compliance.pageLimitTechnical).toBe(10);
    // The deferral explained an EMPTY cell. The cell is no longer empty, so it is gone —
    // reporting both would tell the curator the limit is 10 AND that it is set elsewhere.
    expect(r.deferrals).toEqual([]);
    expect(r.notes.join(' ')).not.toMatch(/defers the technical-volume page limit/i);
    // …and the citation points into the SECOND document, where the rule actually lives.
    expect(r.evidence.page_limit_technical.docSegment).toBe(2);
    expect(r.evidence.page_limit_technical.anchor.excerpt).toMatch(/not to exceed 10 pages/i);
  });

  it('still reports the deferral when the instructions are NOT attached', () => {
    const r = extractByPattern(BAA);
    expect(r.compliance.pageLimitTechnical).toBeUndefined();
    expect(r.deferrals.map((d) => d.field)).toEqual(['page_limit_technical']);
  });

  it('keeps the BAA volume list — the instructions name volumes in a form we do not parse', () => {
    const r = extractByPattern(`${BAA}\n${COMPONENT}`);
    expect(r.volumes).toHaveLength(7);
    expect(r.volumes[6].name).toMatch(/Disclosures of Foreign Affiliations/);
  });
});

describe('parseSolicitation — layers pattern over default (no API key)', () => {
  it('stamps every field with the layer that actually set it', async () => {
    const r = await parseSolicitation(BAA, { agency: 'DoW' });
    expect(r.source).toBe('pattern_match');

    // Read from the document.
    expect(r.fieldSources!.min_font_size).toBe('pattern_match');
    expect(r.fieldSources!.margins).toBe('pattern_match');
    expect(r.fieldSources!.required_sections).toBe('pattern_match');
    expect(r.fieldSources!.volumes).toBe('pattern_match');

    // Not in the document — still the fallback, and still labelled as one.
    expect(r.fieldSources!.font_family).toBe('default');

    // The deferral CLEARS the default rather than asserting 10 pages — and survives as a
    // first-class finding, so the empty cell can explain itself in the workspace.
    expect(r.compliance.pageLimitTechnical).toBeUndefined();
    expect(r.fieldSources!.page_limit_technical).toBe('pattern_match');
    expect(r.deferrals!.page_limit_technical.reason).toMatch(/Component-specific/i);
    // Cited to the Format block on p.4 — the sentence that names the page limit AND where it
    // lives. The p.3 mention says only "does not exceed the page limit", which is not a rule.
    expect(r.deferrals!.page_limit_technical.page).toBe(4);

    // Citations survive to the caller.
    expect(r.fieldEvidence!.min_font_size.excerpt).toMatch(/10-point/);
    expect(r.fieldEvidence!.min_font_size.page).toBe(3);
  });

  it('keeps the document volume list and grafts the default item molds onto it by NAME', async () => {
    const r = await parseSolicitation(BAA, {});
    expect(r.volumes).toHaveLength(7);
    const tech = r.volumes.find((v) => v.name === 'Technical Volume')!;
    expect(tech.items.length).toBe(12);
    const cost = r.volumes.find((v) => v.name === 'Cost Volume')!;
    expect(cost.items.map((i) => i.name)).toEqual(['Phase I Base Cost Proposal', 'Phase I Option Cost Proposal']);
    // Volume 7 has no donor — it gets no borrowed items rather than someone else's.
    expect(r.volumes[6].items).toEqual([]);
  });

  it('still yields the default skeleton, marked default, when there is nothing to read', async () => {
    const r = await parseSolicitation('', { agency: 'Navy' });
    expect(r.source).toBe('default');
    expect(r.volumes.length).toBe(6);
    expect(r.compliance.pageLimitTechnical).toBe(10);
    expect(r.fieldSources!.page_limit_technical).toBe('default');
  });
});
