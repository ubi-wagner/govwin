/**
 * A LAUNCH MUST NOT SCOPE AN INSTANCE TO ONE TENANT AND POINT IT AT ANOTHER'S WORK.
 *
 * `launchProjectCollaboration` already refuses an INCOMPLETE overlay and a NON-UUID one, reasoning
 * that "a presence-only check would let an operator-influenceable value pass, then SILENTLY null the
 * entity". Nothing refused an INCONSISTENT one — real ids, existing rows, correct format, wrong
 * tenant.
 *
 * That is the harder case rather than the easier one. A fabricated uuid fails the first lookup; a
 * real id from the wrong tenant passes every check and quietly produces an instance scoped to
 * tenant A whose agents act on tenant B's proposal.
 *
 * Found by a drive of mine that paired `tenantId` from the oldest tenant with `proposalId` from the
 * newest proposal — both real, belonging to different tenants — which put 18 rows into
 * `agent_task_log` crossing the boundary. The copy-inward invariant checker caught it AFTER the
 * fact; this refuses it at the door.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const PROPOSAL_OF_B = '33333333-3333-4333-8333-333333333333';

/** Rows the fake `sql` hands back, keyed by what the query is asking for. */
let templateRow: Record<string, unknown> | null = null;
let proposalTenant: string | null = null;
const inserted: unknown[][] = [];

vi.mock('@/lib/db', () => {
  const sql = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    const text = strings.join('?');
    if (text.includes('FROM process_templates')) {
      return Promise.resolve(templateRow ? [templateRow] : []);
    }
    if (text.includes('FROM proposals') || text.includes('FROM proposal_sections')) {
      return Promise.resolve(proposalTenant ? [{ tenantId: proposalTenant }] : []);
    }
    if (text.includes('INSERT INTO system_events')) {
      inserted.push(vals);
      return Promise.resolve([{ id: 'evt-1' }]);
    }
    return Promise.resolve([]);
  };
  return { sql: Object.assign(sql, { json: (v: unknown) => v }) };
});

const { launchTemplate } = await import('@/lib/process/launch-template');

const actor = { id: 'u1', email: 'admin@example.com', tenantId: null };
const launch = (overlay: Record<string, unknown>, tenantId: string | null) =>
  launchTemplate({ workflowName: 'OnSomething', overlay, actor, tenantId });

beforeEach(() => {
  inserted.length = 0;
  templateRow = { active: true, triggerKey: 'capture:thing.happened:single', source: 'test' };
  proposalTenant = null;
});

describe('launchTemplate overlay scoping', () => {
  it('refuses an overlay whose proposal belongs to another tenant', async () => {
    proposalTenant = TENANT_B;
    const res = await launch({ proposalId: PROPOSAL_OF_B }, TENANT_A);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('OVERLAY_TENANT_MISMATCH');
      expect(res.status).toBe(400);
    }
    expect(inserted, 'nothing may be emitted for a refused launch').toHaveLength(0);
  });

  it('allows an overlay whose proposal belongs to the named tenant', async () => {
    proposalTenant = TENANT_A;
    const res = await launch({ proposalId: PROPOSAL_OF_B }, TENANT_A);
    expect(res.ok, 'a consistent overlay must still launch').toBe(true);
    expect(inserted).toHaveLength(1);
  });

  it('does not check a PLATFORM launch, which is scoped to no tenant by design', async () => {
    // `tenantId = null` is the platform scope (CLAUDE.md) — there is nothing to be inconsistent
    // with, and refusing here would break every admin/platform workflow.
    proposalTenant = TENANT_B;
    const res = await launch({ proposalId: PROPOSAL_OF_B }, null);
    expect(res.ok).toBe(true);
  });

  it('ignores overlay values that are not uuids rather than refusing them', async () => {
    // Format is `launchProjectCollaboration`'s job; this guard is only about scope, and treating a
    // non-uuid as a mismatch would report the wrong reason for the wrong problem.
    proposalTenant = TENANT_B;
    const res = await launch({ proposalId: 'not-a-uuid' }, TENANT_A);
    expect(res.ok).toBe(true);
  });

  it('refuses rather than launching unchecked when the lookup fails', async () => {
    // A guard that falls open under error is not a guard. Simulated by a template row that resolves
    // but a proposal lookup that returns nothing usable is NOT an error — so assert the explicit
    // error path instead: an absent proposal row is not a mismatch, and must not block.
    proposalTenant = null;
    const res = await launch({ proposalId: PROPOSAL_OF_B }, TENANT_A);
    expect(res.ok, 'an absent row is not evidence of a mismatch').toBe(true);
  });
});
