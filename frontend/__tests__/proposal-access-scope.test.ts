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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * THE COLLABORATOR GATE IS SECTIONS, AND ONLY SECTIONS — decided 2026-08-23, after B83.
 *
 * `collaborator_stage_access` carries an `artifact_types` column. It is SELECTed here and carried in
 * three component prop types, and it is read by no filter, no gate and no rendered element. That is
 * deliberate, not an oversight, and this guard exists because the column LOOKS like a second gate.
 *
 * Why not wire it: B83 was a weaker check (`verifyProposalAccess`) being mistaken for the real one.
 * A second isolation predicate re-creates that shape — `artifact_types` carries no section ids,
 * `assigned_sections` carries no artifact types, and when the two disagree every future reader has
 * to work out which is authoritative. The cost volume is reachable exactly when its sections are in
 * the grant. One predicate, one answer.
 *
 * Source-reading, because what is being pinned is a property of the file: that nobody half-wires the
 * column into a branch. If you are here because this failed, the decision is written up in
 * docs/SCOPE_HITL_PROGRAMME.md and docs/BUG_LOG_2026-08-19.md (B83) — read it before deleting this.
 */
describe('the collaborator grant is assigned_sections, full stop', () => {
  const SRC = readFileSync(join(process.cwd(), 'lib/proposal-access.ts'), 'utf8');

  it('the sections the resolver hands out come from the collaborator grant', () => {
    expect(SRC).toMatch(/collaborator\.assignedSections/);
  });

  it('artifactTypes is carried but never branched on', () => {
    // Every mention must be the type declaration or the SELECT list — never a condition, a filter,
    // an includes(), or an index. Those are the shapes a gate takes.
    const uses = SRC.split('\n')
      .map((line, i) => ({ line: line.trim(), n: i + 1 }))
      .filter((l) => /artifact_types|artifactTypes/.test(l.line));
    expect(uses.length).toBeGreaterThan(0); // if the column is gone entirely, this guard is stale

    const carriedNotRead = uses.every((l) =>
      /^artifactTypes:\s*string\[\];$/.test(l.line)          // the row type
      || /^SELECT permission, artifact_types, stage$/.test(l.line)); // the read
    expect(carriedNotRead, `artifactTypes is branched on: ${JSON.stringify(uses)}`).toBe(true);
  });
});
