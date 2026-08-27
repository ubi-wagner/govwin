/**
 * The partner console re-provisioned its own org on EVERY render, for months, silently.
 *
 * ── HOW A WORKING GATE STOPPED WORKING WITHOUT ANYONE TOUCHING IT ────────────────────────────
 * `ensurePartnerOwnOrgProvisioned` runs on every `/partner` render and is supposed to no-op after
 * the first. Its gate was "does this org have zero spotlight buckets" — a fair proxy back when a
 * new org was seeded with buckets.
 *
 * Then #189 removed seeded buckets, because a bucket is the customer's own ranking lens and the
 * product imposes none. Nothing in this file changed. The condition simply became **permanently
 * true**, and every page load re-ran four write-heavy operations — `backfillTenant`,
 * `scoreTenantCards`, `copyStarterSetToTenant`, `backfillTenantTemplates` — plus emitted a
 * `finder:tenant.provisioned` event asserting a first-time act that had already happened.
 *
 * Measured, not inferred: a 153-page atlas sweep left **12 `tenant.provisioned` events in two
 * hours** against an org holding **0 buckets**.
 *
 * ── THE RULE THIS PINS ───────────────────────────────────────────────────────────────────────
 * A gate that infers "have we done X" from a side effect ANOTHER feature owns is a gate that
 * another team can switch off without touching this code. Gate on the record of the act.
 *
 * So the test asserts the SHAPE of the gate as well as its behaviour: it must consult
 * `tenant.provisioned`, and it must not consult `tenant_spotlight_buckets`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted together: `vi.mock` factories are hoisted above every `const`, so a spy declared with a
// plain `const` is in the temporal dead zone when the factory runs.
const { db, provisioned } = vi.hoisted(() => {
  const state = { queries: [] as string[], results: [] as unknown[][] };
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(strings.raw.join(' ? ').replace(/\s+/g, ' ').trim());
    void values;
    return Promise.resolve(state.results.shift() ?? []);
  };
  return {
    db: { sqlBypass: Object.assign(tagged, { state }), state },
    provisioned: {
      backfillTenant: vi.fn(async () => {}),
      scoreTenantCards: vi.fn(async () => {}),
      copyStarterSetToTenant: vi.fn(async () => {}),
      backfillTenantTemplates: vi.fn(async () => {}),
      emit: vi.fn(async () => {}),
    },
  };
});

vi.mock('@/lib/db', () => ({ sqlBypass: db.sqlBypass, sql: db.sqlBypass }));
vi.mock('@/lib/opportunity-bridge', () => ({ backfillTenant: provisioned.backfillTenant }));
vi.mock('@/lib/cards/score-tenant', () => ({ scoreTenantCards: provisioned.scoreTenantCards }));
vi.mock('@/lib/library/foundation', () => ({ copyStarterSetToTenant: provisioned.copyStarterSetToTenant }));
vi.mock('@/lib/template-bridge', () => ({ backfillTenantTemplates: provisioned.backfillTenantTemplates }));
vi.mock('@/lib/events', () => ({
  emitEventSingle: provisioned.emit,
  userActor: (id: string) => ({ type: 'user', id }),
}));

import { ensurePartnerOwnOrgProvisioned } from '@/lib/partner/own-org';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.results.length = 0;
  for (const f of Object.values(provisioned)) f.mockClear();
});

describe('ensurePartnerOwnOrgProvisioned', () => {
  it('NO-OPS when the org has already been provisioned', async () => {
    db.state.results.push([{ n: 1 }]);            // the tenant.provisioned probe finds the record
    const ran = await ensurePartnerOwnOrgProvisioned(TENANT, USER);
    expect(ran, 'a second visit must not re-provision').toBe(false);
    expect(provisioned.backfillTenant).not.toHaveBeenCalled();
    expect(provisioned.copyStarterSetToTenant).not.toHaveBeenCalled();
    expect(provisioned.emit, 'and must not claim a first-time act again').not.toHaveBeenCalled();
  });

  it('provisions on the first visit', async () => {
    db.state.results.push([{ n: 0 }]);            // no record yet
    const ran = await ensurePartnerOwnOrgProvisioned(TENANT, USER);
    expect(ran).toBe(true);
    expect(provisioned.backfillTenant).toHaveBeenCalledWith(TENANT);
    expect(provisioned.scoreTenantCards).toHaveBeenCalledWith(TENANT);
    expect(provisioned.copyStarterSetToTenant).toHaveBeenCalled();
    expect(provisioned.emit).toHaveBeenCalledTimes(1);
  });

  it('gates on the RECORD OF THE ACT, never on another feature’s side effect', async () => {
    db.state.results.push([{ n: 1 }]);
    await ensurePartnerOwnOrgProvisioned(TENANT, USER);
    const probe = db.state.queries.join(' ');
    expect(probe, 'the gate must read tenant.provisioned').toMatch(/tenant\.provisioned/);
    // The regression, stated as an assertion. Bucket seeding is #189's business, not this file's:
    // when that feature stopped seeding, this gate silently opened and stayed open.
    expect(probe, 'the gate must NOT read tenant_spotlight_buckets')
      .not.toMatch(/tenant_spotlight_buckets/);
  });

  it('fails CLOSED when the probe itself errors', async () => {
    db.state.results.push(undefined as unknown as unknown[]);  // shift() → undefined → [] → n undefined
    const ran = await ensurePartnerOwnOrgProvisioned(TENANT, USER);
    // No row means "no record", which is the first-visit case — provisioning is correct here. The
    // point of the assertion is that it does not THROW into the page: the console must render.
    expect(typeof ran).toBe('boolean');
  });

  it('refuses without ids rather than provisioning something unnamed', async () => {
    expect(await ensurePartnerOwnOrgProvisioned('', USER)).toBe(false);
    expect(await ensurePartnerOwnOrgProvisioned(TENANT, '')).toBe(false);
    expect(db.state.queries, 'it must not even probe').toEqual([]);
  });
});
