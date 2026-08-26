/**
 * ASSIGNMENT IS THE HALF RLS CANNOT ENFORCE, so it gets a test of its own.
 *
 * Migration 216 scopes every delivery table by tenant, and `verify-delivery-isolation.mjs` proves
 * that against a live database. Neither of them can say anything about *which employees of that
 * tenant* may see a project, because the per-request RLS context carries one value — the tenant —
 * and a policy cannot consult the requesting user.
 *
 * CLAUDE.md names the risk directly: "Treat that belt as load-bearing — a new reader that omits it
 * leaks, and RLS will not catch it." So this file asserts the predicate itself, including the two
 * properties a leak would quietly satisfy:
 *
 *   · the query for a plain employee JOINS `delivery_assignments` — without the join it returns
 *     every project at the tenant and every RLS assertion still passes
 *   · the explicit `tenant_id` predicate is present as well, so the query is still correct on a
 *     connection whose context was not set
 *
 * Asserting the SQL TEXT is unusual and deliberate: the join is the security boundary, and its
 * absence produces more rows rather than an error.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queries, sqlMock } = vi.hoisted(() => {
  const queries: string[] = [];
  /** A postgres.js-shaped tagged template that records the text and returns a canned result. */
  const rows: { current: unknown[]; throws: Error | null } = { current: [], throws: null };
  const sqlMock = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      queries.push(strings.raw.join(' ? ').replace(/\s+/g, ' ').trim());
      void values;
      if (rows.throws) return Promise.reject(rows.throws);
      return Promise.resolve(rows.current);
    },
    { rows },
  );
  return { queries, sqlMock };
});

vi.mock('@/lib/db', () => ({ sql: sqlMock }));

import {
  deliveryScope, canAccessProject, listProjectsForActor, canAssign,
} from '@/lib/delivery/access';

const TENANT = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  queries.length = 0;
  sqlMock.rows.current = [];
  sqlMock.rows.throws = null;
});

const lastQuery = () => queries[queries.length - 1] ?? '';

// ── the scope ────────────────────────────────────────────────────────────────────────────────

describe('deliveryScope', () => {
  it('tenant_admin and above see every project at their tenant', () => {
    for (const role of ['tenant_admin', 'rfp_admin', 'master_admin']) {
      expect(deliveryScope({ role, userId: USER }), role).toEqual({ kind: 'all' });
    }
  });

  it('a tenant_user is scoped to what they are assigned', () => {
    expect(deliveryScope({ role: 'tenant_user', userId: USER })).toEqual({ kind: 'assigned', userId: USER });
  });

  it('partner_user is refused outright — membership or not', () => {
    // verifyTenantAccess admits a cross-company collaborator on a source='collaborator'
    // membership, which is correct for the proposal spine. Delivery v1 has no collaborator
    // surface, and refusing the ROLE is what makes that a rule rather than a convention nobody
    // wrote down.
    expect(deliveryScope({ role: 'partner_user', userId: USER })).toEqual({ kind: 'none' });
  });

  it('a bare partner_admin has no delivery reach of its own', () => {
    // It ranks BELOW tenant_admin (50 vs 60) and reaches a tenant only through a membership; when
    // it descends it pins to tenant_admin and arrives as one. The bare role failing closed is the
    // right reading.
    expect(deliveryScope({ role: 'partner_admin', userId: USER })).toEqual({ kind: 'none' });
  });

  it('an unrecognised role is refused', () => {
    expect(deliveryScope({ role: 'auditor', userId: USER })).toEqual({ kind: 'none' });
    expect(deliveryScope({ role: '', userId: USER })).toEqual({ kind: 'none' });
  });
});

// ── the queries, which is where a leak would actually live ──────────────────────────────────

describe('listProjectsForActor — the query itself', () => {
  it('an employee query JOINS delivery_assignments', async () => {
    sqlMock.rows.current = [];
    await listProjectsForActor({ userId: USER, role: 'tenant_user', tenantId: TENANT });
    const q = lastQuery();
    expect(q, 'without this join the query returns EVERY project at the tenant, and every RLS '
      + 'assertion still passes').toMatch(/JOIN delivery_assignments/i);
    expect(q).toMatch(/a\.user_id =/i);
  });

  it('every query carries an explicit tenant predicate as well as RLS', async () => {
    for (const role of ['tenant_admin', 'tenant_user']) {
      queries.length = 0;
      await listProjectsForActor({ userId: USER, role, tenantId: TENANT });
      expect(lastQuery(), `${role}: defense-in-depth — the query must still be correct on a `
        + 'connection whose RLS context was not set').toMatch(/tenant_id =/i);
    }
  });

  it('a refused role issues NO query at all', async () => {
    const out = await listProjectsForActor({ userId: USER, role: 'partner_user', tenantId: TENANT });
    expect(out).toEqual([]);
    expect(queries, 'a refusal must not reach the database — an empty result from a query that ran '
      + 'is indistinguishable from one that was scoped out').toEqual([]);
  });

  it('fails CLOSED when the database is unreachable', async () => {
    // An access check that cannot reach the database has not established access. Returning
    // whatever it has so far, or throwing into a caller that catches broadly, is how an outage
    // becomes permission.
    sqlMock.rows.throws = new Error('ECONNREFUSED');
    try {
      await expect(listProjectsForActor({ userId: USER, role: 'tenant_admin', tenantId: TENANT }))
        .resolves.toEqual([]);
      await expect(canAccessProject({ userId: USER, role: 'tenant_admin', tenantId: TENANT }, PROJECT))
        .resolves.toBe(false);
    } finally { sqlMock.rows.throws = null; }
  });
});

describe('canAccessProject', () => {
  it('an assigned employee reaching their own project uses the assignment join', async () => {
    sqlMock.rows.current = [{ id: PROJECT }];
    const allowed = await canAccessProject({ userId: USER, role: 'tenant_user', tenantId: TENANT }, PROJECT);
    expect(allowed).toBe(true);
    expect(lastQuery()).toMatch(/JOIN delivery_assignments/i);
  });

  it('an UNASSIGNED employee in the same tenant is refused', async () => {
    // The join returns nothing. This is the case RLS cannot catch: same tenant, valid membership,
    // valid session — and no business seeing that contract.
    sqlMock.rows.current = [];
    const allowed = await canAccessProject({ userId: USER, role: 'tenant_user', tenantId: TENANT }, PROJECT);
    expect(allowed).toBe(false);
  });

  it('a tenant_admin reaches it without an assignment row', async () => {
    sqlMock.rows.current = [{ id: PROJECT }];
    const allowed = await canAccessProject({ userId: USER, role: 'tenant_admin', tenantId: TENANT }, PROJECT);
    expect(allowed).toBe(true);
    expect(lastQuery()).not.toMatch(/delivery_assignments/i);
  });

  it('partner_user is refused without a query', async () => {
    sqlMock.rows.current = [{ id: PROJECT }];   // even if a row WOULD come back
    const allowed = await canAccessProject({ userId: USER, role: 'partner_user', tenantId: TENANT }, PROJECT);
    expect(allowed).toBe(false);
    expect(queries).toEqual([]);
  });
});

describe('canAssign', () => {
  it('only tenant_admin and above may change who is on a project', () => {
    expect(canAssign('tenant_admin')).toBe(true);
    expect(canAssign('rfp_admin')).toBe(true);
    expect(canAssign('tenant_user')).toBe(false);
    expect(canAssign('partner_user')).toBe(false);
    expect(canAssign('partner_admin')).toBe(false);
    expect(canAssign('nonsense')).toBe(false);
  });
});
