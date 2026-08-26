/**
 * A document we stopped reading cannot support "not stated in the source" (bug log B40).
 *
 * Extraction caps source text, and two of five real BAAs landed on the cap to the character — the
 * last 50.7% of the DoW 2026 SBIR BAA and 62.7% of the DoD 25.1 BAA were never examined. Every
 * `default` in the compliance matrix is presented as "the solicitation does not state this", and
 * past the cut that claim is unfounded: the rule may be stated on a page nobody read.
 *
 * The truncation WAS being recorded — on the document, by the upload route — and read by nothing.
 * `extractionOf` and `truncationNotice` existed with zero callers, which made it a fact filed where
 * no one looks. These lock the reading end: the provenance audit a curator sees before landing a
 * matrix must say so, and must keep quiet when the document was read whole.
 */
import { describe, it, expect } from 'vitest';
import { auditProvenance } from '@/lib/ingest/provenance-audit';
import { capSourceText, truncationNotice, extractionOf } from '@/lib/ingest/source-text-cap';

/** A matrix where something WAS read, so `nothingRead` is not what fires. */
const READ_MATRIX = {
  fieldProvenance: {
    page_limit_technical: { source: 'pattern_match', page: 12, excerpt: 'shall not exceed 15 pages' },
    font_size: { source: 'pattern_match', page: 12, excerpt: '11-point' },
    submission_format: { source: 'default' },
  },
  values: { pageLimitTechnical: 15, fontSize: 11, submissionFormat: 'pdf' },
};

const doc = (fileName: string, chars: number, originalChars: number) => ({
  documentType: 'source', fileName,
  extraction: { chars, originalChars, truncated: chars < originalChars },
});

const truncationFindings = (docs: Parameters<typeof auditProvenance>[0]['documents']) =>
  auditProvenance({ ...READ_MATRIX, documents: docs })
    .findings.filter((f) => /partly read/i.test(f.issue));

describe('provenance audit — a partly-read document is reported', () => {
  it('fires when a source document hit the cap', () => {
    const f = truncationFindings([doc('DoW-2026-SBIR-BAA.pdf', 500_000, 1_013_000)]);
    expect(f).toHaveLength(1);
    expect(f[0].severity).toBe('warning');
  });

  it('names the document and the share that was never examined', () => {
    // The share is the number that changes the reader's mind: "we read 500,000 characters" sounds
    // thorough, "51% was not examined" does not.
    const [f] = truncationFindings([doc('DoW-2026-SBIR-BAA.pdf', 500_000, 1_013_000)]);
    expect(f.issue).toContain('DoW-2026-SBIR-BAA.pdf');
    expect(f.issue).toContain('51%');
    expect(f.issue).toMatch(/unverified/i);
  });

  it('reports the WORST document when several were cut', () => {
    const [f] = truncationFindings([
      doc('small-cut.pdf', 500_000, 560_000),      // 11% lost
      doc('big-cut.pdf', 500_000, 1_340_000),      // 63% lost
    ]);
    expect(f.issue).toContain('big-cut.pdf');
    expect(f.issue).toContain('2 source document(s)');
  });

  it('stays silent when every document was read whole', () => {
    expect(truncationFindings([doc('short.pdf', 288_002, 288_002)])).toHaveLength(0);
  });

  it('stays silent when the stamp is absent, rather than claiming completeness', () => {
    // Rows ingested before the stamp existed read as UNKNOWN. Inventing "complete" for them would
    // be the same defect in the other direction.
    expect(truncationFindings([{ documentType: 'source', fileName: 'legacy.pdf' }])).toHaveLength(0);
  });

  it('does not disturb the findings that were already there', () => {
    const before = auditProvenance({ ...READ_MATRIX, documents: [doc('whole.pdf', 100, 100)] });
    const after = auditProvenance({ ...READ_MATRIX, documents: [doc('cut.pdf', 50, 100)] });
    // submission_format is a system default in both, and still says so in both. Matched on the
    // finding's SHAPE — a per-field finding carries `field` — not on its prose: the truncation
    // finding legitimately contains the words "system default" too, and a text matcher counted it
    // as a second per-field finding.
    const defaultFinding = (a: typeof before) =>
      a.findings.filter((f) => f.field !== null && /system default/i.test(f.issue));
    expect(defaultFinding(after)).toHaveLength(defaultFinding(before).length);
    expect(after.read).toBe(before.read);
  });
});

describe('source-text-cap — the writing end', () => {
  it('reports the cut rather than only performing it', () => {
    const c = capSourceText('x'.repeat(1000), 400);
    expect(c).toMatchObject({ chars: 400, originalChars: 1000, truncated: true, capChars: 400 });
  });

  it('leaves a short document alone', () => {
    expect(capSourceText('short', 400)).toMatchObject({ truncated: false, chars: 5, originalChars: 5 });
  });

  it('round-trips through the metadata stamp the upload writes', () => {
    const c = capSourceText('y'.repeat(900), 300);
    const stamped = { extraction: { chars: c.chars, truncated: c.truncated, originalChars: c.originalChars } };
    const back = extractionOf(stamped);
    expect(back).toMatchObject({ chars: 300, truncated: true, originalChars: 900 });
    expect(truncationNotice(back)).toMatch(/67% of this document was not examined/);
  });

  it('has no notice to give when nothing was cut', () => {
    expect(truncationNotice(extractionOf({ extraction: { chars: 10, truncated: false, originalChars: 10 } }))).toBeNull();
  });
});
