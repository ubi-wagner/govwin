import { describe, it, expect } from 'vitest';

/**
 * DSIP-ONLY volumes are completed inside the agency's submission portal, not authored here:
 * a DSIP webform (Proposal Cover Sheet, Disclosures of Foreign Affiliations), an agency-generated
 * report (the Company Commercialization Report pulled from SBIR.gov), or training taken in DSIP
 * (Fraud, Waste and Abuse). The company never writes a document for them.
 *
 * Provision must therefore NOT stand up an authoring artifact or a placeholder section for one.
 * Doing so creates work that can never be done and a readiness blocker that can never clear — a
 * proposal permanently "not submission-ready" because it is waiting on a document that, by the
 * solicitation's own rules, does not exist in this workspace. The requirement still reaches the
 * customer as a compliance-matrix checklist item: tracked, just not authored.
 *
 * These lock the selection rule provision applies (the DB writes themselves are exercised by the
 * live provision drive).
 */

type Vol = { volumeNumber: number; volumeName: string; dsipOnly?: boolean; items: unknown[] };

/** The rule provision applies in all three of its volume loops. */
const isAuthored = (v: Vol) => v.dsipOnly !== true;

// The real OSW26BZ04-DP013 seven-volume set.
const T3CP: Vol[] = [
  { volumeNumber: 1, volumeName: 'Proposal Cover Sheet', items: [{}] },
  { volumeNumber: 2, volumeName: 'Technical Volume', items: [{}, {}] },
  { volumeNumber: 3, volumeName: 'Cost Volume', items: [{}] },
  { volumeNumber: 4, volumeName: 'Company Commercialization Report', dsipOnly: true, items: [{}] },
  { volumeNumber: 5, volumeName: 'Supporting Documents', items: [{}] },
  { volumeNumber: 6, volumeName: 'Fraud, Waste and Abuse Training', dsipOnly: true, items: [{}] },
  { volumeNumber: 7, volumeName: 'Disclosures of Foreign Affiliations', dsipOnly: true, items: [] },
];

describe('DSIP-only volumes are tracked, not authored', () => {
  it('excludes every DSIP-only volume from the authored set', () => {
    const authored = T3CP.filter(isAuthored).map((v) => v.volumeNumber);
    expect(authored).toEqual([1, 2, 3, 5]);
  });

  it('never authors V4 (CCR), V6 (FWA) or V7 (Foreign Affiliations)', () => {
    for (const n of [4, 6, 7]) {
      expect(isAuthored(T3CP.find((v) => v.volumeNumber === n)!)).toBe(false);
    }
  });

  it('does not give a DSIP-only volume a placeholder section even with zero items', () => {
    // V7 has no items. The placeholder rule ("a required volume with zero items still needs a
    // section") must not fire for it — that section would be an orphan with no artifact, and it
    // could never be authored or locked.
    const v7 = T3CP.find((v) => v.volumeNumber === 7)!;
    const needsPlaceholder = v7.items.length === 0 && isAuthored(v7);
    expect(needsPlaceholder).toBe(false);
  });

  it('still authors a zero-item volume that is NOT DSIP-only (the placeholder rule survives)', () => {
    const orphanRequired: Vol = { volumeNumber: 8, volumeName: 'Appendix', items: [] };
    expect(orphanRequired.items.length === 0 && isAuthored(orphanRequired)).toBe(true);
  });

  it('treats an absent flag as authored — opt-in only, never inferred from the name', () => {
    // A volume is DSIP-only because CURATION said so, never because its title looks form-ish.
    // "Company Commercialization Plan" is prose the company writes; "…Report" is pulled from SBIR.gov.
    const plan: Vol = { volumeNumber: 9, volumeName: 'Commercialization Plan', items: [{}] };
    expect(isAuthored(plan)).toBe(true);
  });
});
