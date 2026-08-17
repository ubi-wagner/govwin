/**
 * resolveUserAccess — CAP-3 per-proposal scoping for an internal tenant_user.
 *
 * A tenant_user whose membership.scope marks them proposalScoped gets FULL (contributor)
 * access ONLY for the proposals in scope.proposals. For ANY other proposal they fall through
 * to the collaborator lookup and — absent a grant — resolve to NO_ACCESS (role 'external',
 * zero sections). Default scope {} stays tenant-wide, so existing users are unaffected:
 * this is the data-layer half of the CAP-3 boundary the workspace page renders off.
 *
 * Mocks only @/lib/db's `sql` (the sequence of reads); @/lib/jsonb coerceJsonb is REAL so the
 * scope jsonb is parsed exactly as in prod.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { sqlMock } = vi.hoisted(() => ({ sqlMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ sql: sqlMock }));

import { resolveUserAccess } from '@/lib/proposal-access';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GRANTED = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

// Rows come back camelCased (postgres.toCamel) — the mock returns the exact shapes the resolver reads.
const proposalRead = [{ lockCount: 1, isLocked: false, unlockDeadline: null, tenantId: TENANT, stage: 'draft' }];
const userRead = [{ role: 'tenant_user', tenantId: null }];

beforeEach(() => { sqlMock.mockReset(); });

describe('resolveUserAccess — CAP-3 per-proposal scoping', () => {
  it('scoped tenant_user on a GRANTED proposal → contributor with all sections', async () => {
    sqlMock
      .mockResolvedValueOnce(proposalRead)                                                        // proposals
      .mockResolvedValueOnce(userRead)                                                            // users
      .mockResolvedValueOnce([{ role: 'tenant_user', scope: { proposalScoped: true, proposals: [GRANTED] } }]) // membership
      .mockResolvedValueOnce([{ id: 'sec-1', completedStage: null }])                             // sections (isTenantWide branch)
      .mockResolvedValueOnce([{ gateConfig: ['draft', 'final'] }]);                               // gate_config
    const a = await resolveUserAccess(USER, GRANTED, TENANT);
    expect(a.role).toBe('contributor');
    expect(a.viewableSections).toContain('sec-1');
    expect(a.commentableSections).toContain('sec-1');
  });

  it('scoped tenant_user on a NON-granted proposal → NO_ACCESS (external, zero sections)', async () => {
    sqlMock
      .mockResolvedValueOnce(proposalRead)                                                        // proposals
      .mockResolvedValueOnce(userRead)                                                            // users
      .mockResolvedValueOnce([{ role: 'tenant_user', scope: { proposalScoped: true, proposals: [GRANTED] } }]) // membership
      .mockResolvedValueOnce([]);                                                                 // proposal_collaborators (no grant)
    const a = await resolveUserAccess(USER, OTHER, TENANT);
    expect(a.role).toBe('external');
    expect(a.editableSections).toEqual([]);
    expect(a.commentableSections).toEqual([]);
    expect(a.viewableSections).toEqual([]);
    expect(a.canUpload).toBe(false);
    expect(a.canExport).toBe(false);
  });

  it('UNSCOPED tenant_user (default {} scope) stays tenant-wide → contributor (no regression)', async () => {
    sqlMock
      .mockResolvedValueOnce(proposalRead)
      .mockResolvedValueOnce(userRead)
      .mockResolvedValueOnce([{ role: 'tenant_user', scope: {} }])                                // unscoped membership
      .mockResolvedValueOnce([{ id: 'sec-1', completedStage: null }])
      .mockResolvedValueOnce([{ gateConfig: ['draft', 'final'] }]);
    const a = await resolveUserAccess(USER, OTHER, TENANT);
    expect(a.role).toBe('contributor');
    expect(a.viewableSections).toContain('sec-1');
  });
});
