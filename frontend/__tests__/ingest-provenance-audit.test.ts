/**
 * The ingest provenance audit — lib/ingest/provenance-audit.ts.
 *
 * The finding this exists for: a compliance matrix can be COMPLETE and wrong, or INCOMPLETE and
 * exactly right. The DoW SBIR BAA states its format rules but defers the technical-volume page
 * limit to the Component-specific instructions, which arrive as a separate PDF. Counting filled
 * cells cannot tell those states apart; reading field_provenance can.
 */
import { describe, expect, it } from 'vitest';
import { auditProvenance, summarizeAudit } from '@/lib/ingest/provenance-audit';

const deferralEntry = {
  source: 'pattern_match', deferred: true, page: 32,
  reason: 'The solicitation defers the technical-volume page limit to the Service/Component-specific topic instructions.',
  excerpt: 'refer to Service/Component-specific topic instructions for the page limit',
};

describe('auditProvenance — an unresolved deferral is a release blocker', () => {
  it('BLOCKS when the rule is deferred and no rule-bearing document is attached', () => {
    const a = auditProvenance({
      fieldProvenance: {
        page_limit_technical: deferralEntry,
        min_font_size: { source: 'pattern_match', page: 19, excerpt: 'no type smaller than 10-point' },
        margins: { source: 'pattern_match', page: 32, excerpt: 'Page margins one inch on all sides' },
        font_family: { source: 'default' },
      },
      values: { minFontSize: 10, margins: '1 inch (all sides)', fontFamily: 'Times New Roman' },
      documents: [{ documentType: 'rfp', fileName: 'DoW_2026_SBIR_BAA_Preface.pdf' }],
    });

    expect(a.deferred).toBe(1);
    expect(a.unresolvedDeferrals.map((f) => f.field)).toEqual(['page_limit_technical']);

    const blockers = a.findings.filter((f) => f.severity === 'blocker');
    expect(blockers).toHaveLength(1);
    expect(blockers[0].field).toBe('page_limit_technical');
    expect(blockers[0].issue).toMatch(/nowhere on file/);
    expect(blockers[0].fix).toMatch(/Upload the Component-specific instructions/);
  });

  it('DOWNGRADES to a warning once the instructions are attached but nothing was read from them', () => {
    const a = auditProvenance({
      fieldProvenance: { page_limit_technical: deferralEntry },
      values: {},
      documents: [
        { documentType: 'rfp', fileName: 'BAA.pdf' },
        { documentType: 'instructions', fileName: 'OSWT3CP_SBIR_26BZ_R4_v2.pdf' },
      ],
    });
    const forField = a.findings.filter((f) => f.field === 'page_limit_technical');
    expect(forField[0].severity).toBe('warning');
    expect(forField[0].issue).toMatch(/OSWT3CP_SBIR_26BZ_R4_v2\.pdf/);
    expect(a.findings.some((f) => f.severity === 'blocker' && f.field === 'page_limit_technical')).toBe(false);
  });

  it('CLEARS entirely once a value was read — the deferral is resolved, not merely attached', () => {
    const a = auditProvenance({
      fieldProvenance: {
        page_limit_technical: {
          source: 'pattern_match', page: 3, docSegment: 2,
          excerpt: 'Technical Volume is not to exceed 10 pages',
        },
      },
      values: { pageLimitTechnical: 10 },
      documents: [
        { documentType: 'rfp', fileName: 'BAA.pdf' },
        { documentType: 'instructions', fileName: 'OSWT3CP_SBIR_26BZ_R4_v2.pdf' },
      ],
    });
    expect(a.unresolvedDeferrals).toEqual([]);
    expect(a.findings.some((f) => f.field === 'page_limit_technical')).toBe(false);
    expect(a.read).toBe(1);
  });
});

describe('auditProvenance — defaults are never silent', () => {
  it('flags an all-default matrix as the "empty parse" blocker', () => {
    const a = auditProvenance({
      fieldProvenance: {
        page_limit_technical: { source: 'default' }, font_family: { source: 'default' },
        min_font_size: { source: 'default' }, margins: { source: 'default' },
        submission_format: { source: 'default' }, required_sections: { source: 'default' },
      },
      values: { pageLimitTechnical: 10, fontFamily: 'Times New Roman', minFontSize: 10 },
      documents: [{ documentType: 'rfp', fileName: 'BAA.pdf' }],
    });
    expect(a.nothingRead).toBe(true);
    expect(a.read).toBe(0);
    expect(a.coverage).toBe(0);
    const blockers = a.findings.filter((f) => f.severity === 'blocker');
    expect(blockers).toHaveLength(1);
    expect(blockers[0].issue).toMatch(/entire matrix is system defaults/);
  });

  it('treats an unstamped legacy row (pre-mig-187) as unverified, not as read', () => {
    const a = auditProvenance({
      fieldProvenance: {},
      values: { pageLimitTechnical: 15, fontFamily: 'Arial' },
      documents: [],
    });
    expect(a.read).toBe(0);
    expect(a.unknown).toBe(a.fieldsTotal);
    expect(a.unverified.map((f) => f.field)).toContain('page_limit_technical');
  });

  it('counts a real read matrix as covered and raises no blocker', () => {
    const a = auditProvenance({
      fieldProvenance: {
        page_limit_technical: { source: 'pattern_match' }, min_font_size: { source: 'pattern_match' },
        margins: { source: 'pattern_match' }, submission_format: { source: 'pattern_match' },
        required_sections: { source: 'pattern_match' }, required_documents: { source: 'hitl' },
        font_family: { source: 'verified' }, font_size: { source: 'ai' },
      },
      values: {
        pageLimitTechnical: 10, minFontSize: 10, margins: '1 inch', submissionFormat: 'x',
        requiredSections: ['a'], requiredDocuments: ['b'], fontFamily: 'Arial', fontSize: '10',
      },
      documents: [{ documentType: 'instructions', fileName: 'comp.pdf' }],
    });
    expect(a.read).toBe(8);
    expect(a.coverage).toBe(1);
    expect(a.findings.filter((f) => f.severity === 'blocker')).toHaveLength(0);
    expect(summarizeAudit(a)).toMatch(/8\/8 compliance fields read/);
  });
});
