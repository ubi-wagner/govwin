/**
 * THE TWO GATES ON THE LIBRARY ASSEMBLER — pinned in the source, because they were absent once.
 *
 * What happened: `POST …/sections/[s]/assemble` shipped with `verifyProposalAccess` as its only
 * check. That function answers "can this actor reach this proposal", and an accepted collaborator
 * can — by design. It is not a library check and not a section check, and was never meant to be.
 *
 * Measured on a running box before the fix: a `partner_user` subcontractor granted ONE narrative
 * section POSTed at the COST VOLUME and got 200 back, with 12 tenant library atom ids in the
 * response and a real `canvas_versions` row written. The tenant's entire library and another
 * volume's artifact, from a grant that covered neither.
 *
 * Two gates close it, and NEITHER implies the other:
 *
 *   1. ROLE — the tenant library is team-only (`tenant_user`+), matching every other library route.
 *      Without this a collaborator reads the company's past proposals, cost models and bios.
 *   2. SECTION — edit access to THIS section specifically. Role rank alone is not enough: a
 *      `tenant_user` who is only a per-proposal contributor holds edit rights on some sections and
 *      not others, and assembling proposes a version of whichever section is named.
 *
 * ORDER IS PART OF THE CONTRACT. Both gates must run BEFORE `selectForSection`, which is the call
 * that reads the library. A check that runs after the read has already leaked; it only stops the
 * write.
 *
 * A source-reading guard rather than a mocked request, deliberately: the failure mode being pinned
 * is "someone deletes or reorders a check", and that is a property of the file. The live proof that
 * the gates actually refuse is `scripts/verify-collaborator-blast-radius.mjs`, which drives a real
 * signed-in subcontractor against every surface that could leak.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = readFileSync(join(
  process.cwd(),
  'app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/assemble/route.ts',
), 'utf8');

/** Where the library is actually read. Everything protective must precede it. */
const libraryReadAt = SRC.indexOf('await selectForSection(');

describe('gate 1 · the tenant library is team-only', () => {
  it('the route requires tenant_user or above', () => {
    expect(SRC).toMatch(/hasRoleAtLeast\(role,\s*'tenant_user'\)/);
  });

  it('and it says so in words a collaborator can act on', () => {
    // "Forbidden" tells someone nothing. Naming the reason is the difference between a wall and a
    // sign, and this route is reachable by people who are legitimately on the proposal.
    expect(SRC).toContain('The tenant library is available to team members only.');
  });

  it('the role check runs BEFORE the library is read', () => {
    const roleGateAt = SRC.search(/hasRoleAtLeast\(role,\s*'tenant_user'\)/);
    expect(roleGateAt).toBeGreaterThan(-1);
    expect(libraryReadAt).toBeGreaterThan(-1);
    expect(roleGateAt).toBeLessThan(libraryReadAt);
  });
});

describe('gate 2 · and edit access to THIS section', () => {
  it('the route resolves per-section access', () => {
    expect(SRC).toMatch(/resolveUserAccess\(/);
    expect(SRC).toMatch(/editableSections\.includes\(sectionId\)/);
  });

  it('the section check runs BEFORE the library is read', () => {
    const sectionGateAt = SRC.search(/editableSections\.includes\(sectionId\)/);
    expect(sectionGateAt).toBeGreaterThan(-1);
    expect(sectionGateAt).toBeLessThan(libraryReadAt);
  });

  it('an admin is not narrowed by it', () => {
    // `resolveUserAccess` returns `editableSections: []` for a LOCKED proposal, admin included.
    // Without the admin arm this gate would refuse a tenant_admin on their own locked build — and
    // the route already 423s on a locked SECTION, which is the check that belongs there.
    expect(SRC).toMatch(/access\.role === 'admin'/);
  });
});

describe('the gate that was never enough on its own', () => {
  it('verifyProposalAccess is still called — it answers a different question', () => {
    // Not removed: it binds the proposal to the tenant, which neither gate above does. Three
    // checks, three questions: which tenant, which team, which section.
    expect(SRC).toMatch(/verifyProposalAccess\(/);
  });

  it('and the file records WHY it was not sufficient', () => {
    // Whitespace-normalised: the sentence spans a comment line break, so an exact-substring match
    // would fail on re-wrapping rather than on the claim. What is being pinned is that the reason
    // is written down — the next person to look at `verifyProposalAccess` and think it covers this
    // should find the answer in the file, not in a commit message.
    const prose = SRC.replace(/^\s*\/\/ ?/gm, '').replace(/\s+/g, ' ');
    expect(prose).toContain('an accepted collaborator can, by design');
  });
});
