/**
 * Marking a requirement "completed elsewhere" must not make the proposal permanently unsubmittable.
 *
 * THE CASE THAT FORCED THIS. A DoW 2026 SBIR build, provisioned from a real BAA. The rfp_admin did
 * exactly the right thing in the provisioning cockpit: marked the DSIP cover sheet, the Company
 * Commercialization Report, the FWA training certificate, the five supporting-document PDFs and an
 * items-less Volume 7 as completed in the agency portal. Provisioning correctly gave those no
 * section — there is nothing for the buyer to author — and recorded each as a mandatory
 * compliance-matrix row so the obligation left a trace.
 *
 * Readiness then read those nine section-less rows as `orphan_requirement` BLOCKERS. There is no
 * section to lock, no field to fill and no control anywhere that satisfies a section-less row, so
 * the buyer could not reach `final`, could not lock the proposal, and could not export a submission
 * package. Ever. The admin's correct action was what broke it.
 *
 * The split has to be STRUCTURAL. `notes` is free text an admin may leave blank, and every
 * provenance bug in this codebase has been a mark that got dropped somewhere downstream. The one
 * reliable signal is that provision-proposal.ts's completed-elsewhere loop is the ONLY insert that
 * passes a null section_id — every other write site passes a real one.
 */
import { describe, it, expect } from 'vitest';
import { classifyUnmetRequirement } from '@/lib/proposal/submission-readiness';

const LIVE = new Set(['sec-1', 'sec-2']);
const row = (over: Partial<Parameters<typeof classifyUnmetRequirement>[0]> = {}) => ({
  requirementText: 'DD Form 2345 — Militarily Critical Technical Data Agreement',
  status: 'not_addressed',
  sectionId: null as string | null,
  notes: null as string | null,
  ...over,
});

describe('completed elsewhere', () => {
  it('is a warning, not a blocker — the buyer can never clear it from here', () => {
    const b = classifyUnmetRequirement(row(), LIVE);
    expect(b?.severity).toBe('warning');
  });

  it('still says the buyer has to file it — not authored here is not not required', () => {
    const b = classifyUnmetRequirement(row(), LIVE);
    expect(b?.message).toContain('you still have to file it');
    expect(b?.message).toContain('DD Form 2345');
  });

  it("carries the admin's note saying where, when there is one", () => {
    const b = classifyUnmetRequirement(
      row({ notes: 'Filed in DSIP under Firm Forms.' }), LIVE);
    expect(b?.message).toContain('Filed in DSIP under Firm Forms.');
  });

  it('survives a blank note — the note is a courtesy, not the signal', () => {
    const b = classifyUnmetRequirement(row({ notes: '   ' }), LIVE);
    expect(b?.severity).toBe('warning');
    expect(b?.message).not.toMatch(/—\s*$/);
  });

  it('is still surfaced — silently dropping it would read as not required', () => {
    expect(classifyUnmetRequirement(row(), LIVE)).not.toBeNull();
  });
});

describe('a real orphan is still a blocker', () => {
  it('a row naming a section that no longer exists blocks submission', () => {
    const b = classifyUnmetRequirement(row({ sectionId: 'deleted-section' }), LIVE);
    expect(b?.severity).toBe('blocker');
    expect(b?.message).toContain('not covered by any section');
  });
});

describe('a requirement a live section owns is not surfaced twice', () => {
  it('returns null — that section\'s own empty/unlocked blocker already covers it', () => {
    expect(classifyUnmetRequirement(row({ sectionId: 'sec-1' }), LIVE)).toBeNull();
  });
});

describe('met requirements produce nothing', () => {
  it.each(['satisfied', 'not_applicable'])('%s', (status) => {
    expect(classifyUnmetRequirement(row({ status }), LIVE)).toBeNull();
    // …including when it is section-less, so an admin-waived external item stays quiet once met.
    expect(classifyUnmetRequirement(row({ status, sectionId: null }), LIVE)).toBeNull();
  });
});
