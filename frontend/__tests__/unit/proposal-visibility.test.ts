/**
 * hasProposalVisibility — the read gate the per-proposal API routes use to close the CAP-3 leak
 * (a proposal-scoped tenant_user reading a proposal outside their grant). Pure function → unit test.
 */
import { describe, it, expect } from 'vitest';
import { hasProposalVisibility } from '@/lib/proposal-access';
import type { UserAccess } from '@/lib/proposal-access';

const base: UserAccess = {
  role: 'external', editableSections: [], commentableSections: [], viewableSections: [],
  canUpload: false, canAdvance: false, canManageTeam: false, canExport: false,
  lockCount: 0, isLocked: false, unlockDeadline: null, currentStage: 'draft', accessibleStages: [],
};

describe('hasProposalVisibility', () => {
  it('ALLOWS a tenant_admin (role admin) even on a section-less proposal', () => {
    expect(hasProposalVisibility({ ...base, role: 'admin' })).toBe(true);
  });

  it('ALLOWS a tenant-wide tenant_user (role contributor) even with no sections listed', () => {
    expect(hasProposalVisibility({ ...base, role: 'contributor' })).toBe(true);
  });

  it('ALLOWS a section-granted external collaborator', () => {
    expect(hasProposalVisibility({ ...base, role: 'external', viewableSections: ['s1'] })).toBe(true);
    expect(hasProposalVisibility({ ...base, role: 'external', editableSections: ['s2'] })).toBe(true);
    expect(hasProposalVisibility({ ...base, role: 'external', commentableSections: ['s3'] })).toBe(true);
  });

  it('DENIES the NO_ACCESS shape — a scoped-out tenant_user / non-collaborator (external, no grants)', () => {
    expect(hasProposalVisibility(base)).toBe(false);
  });
});
