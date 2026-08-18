/**
 * Ingest Studio — the stage/land contract (docs/INGEST_STUDIO_DESIGN.md).
 *
 * These are the invariants, not the plumbing. The plumbing (a real DB round-trip) is proven by
 * the live drive; what must never regress silently is the DECISION LOGIC around landing, because
 * the failure mode is a fabricated compliance value reaching a customer.
 */
import { describe, expect, it } from 'vitest';
import { nextPhase, type IngestPhase } from '@/lib/ingest/stage-skeleton';
import { auditProvenance } from '@/lib/ingest/provenance-audit';

describe('phase machine', () => {
  it('walks extract → matrix → review → landed → molds → complete', () => {
    const seen: IngestPhase[] = [];
    let p: IngestPhase = 'not_started';
    for (let i = 0; i < 8 && p !== 'complete'; i++) { p = nextPhase(p); seen.push(p); }
    expect(seen).toEqual(['extract', 'matrix', 'review', 'landed', 'molds', 'complete']);
  });

  it('terminates at complete rather than wrapping', () => {
    expect(nextPhase('complete')).toBe('complete');
  });
});

describe('the land gate — what an automation policy may and may not do', () => {
  /** The DoW case with the Component instructions MISSING: a rule deferred to nowhere. */
  const unfounded = auditProvenance({
    fieldProvenance: {
      page_limit_technical: {
        source: 'pattern_match', deferred: true, page: 32,
        reason: 'The solicitation defers the technical-volume page limit to the Service/Component-specific topic instructions.',
      },
      min_font_size: { source: 'pattern_match' },
    },
    values: { minFontSize: 10 },
    documents: [{ documentType: 'rfp', fileName: 'BAA.pdf' }],
  });

  /** The same solicitation once those instructions are attached and read. */
  const sound = auditProvenance({
    fieldProvenance: {
      page_limit_technical: { source: 'pattern_match', page: 2, docSegment: 2 },
      min_font_size: { source: 'pattern_match' }, margins: { source: 'pattern_match' },
      font_family: { source: 'default' },
    },
    values: { pageLimitTechnical: 10, minFontSize: 10, margins: '1 inch', fontFamily: 'Times New Roman' },
    documents: [
      { documentType: 'rfp', fileName: 'BAA.pdf' },
      { documentType: 'instructions', fileName: 'OSWT3CP.pdf' },
    ],
  });

  const blockers = (a: ReturnType<typeof auditProvenance>) =>
    a.findings.filter((f) => f.severity === 'blocker');

  it('BLOCKS a matrix whose rule is deferred to a document nobody attached', () => {
    expect(blockers(unfounded)).toHaveLength(1);
    expect(blockers(unfounded)[0].issue).toMatch(/nowhere on file/);
  });

  it('permits a matrix that was actually read, even with some fields on defaults', () => {
    expect(blockers(sound)).toHaveLength(0);
    // …and the defaulted typeface is still reported, just not as a blocker: it arrives wearing
    // its red badge rather than silently passing as a rule.
    expect(sound.unverified.map((f) => f.field)).toContain('font_family');
  });

  it('treats "nothing was read" as a blocker no matter how many rows exist', () => {
    const allDefault = auditProvenance({
      fieldProvenance: {
        page_limit_technical: { source: 'default' }, min_font_size: { source: 'default' },
        margins: { source: 'default' }, font_family: { source: 'default' },
        submission_format: { source: 'default' }, required_sections: { source: 'default' },
      },
      values: { pageLimitTechnical: 10, minFontSize: 10, margins: '1 inch' },
      documents: [{ documentType: 'rfp', fileName: 'BAA.pdf' }],
    });
    expect(allDefault.nothingRead).toBe(true);
    expect(blockers(allDefault).some((f) => /entire matrix is system defaults/.test(f.issue))).toBe(true);
  });
});
