/**
 * LABOUR ACTUALS — the input the cost measure never had.
 *
 * `rollup.ts` reported cost against `project_wbs_nodes.actual_cost`, a column nothing wrote. Its
 * honest `null` → "not measured" was hiding a missing INPUT, not a missing number, which is the
 * worse kind of empty: it reads as restraint.
 *
 * The cases here are about the two things that make hours into money — the WBS node they land on,
 * and the approval that lets them count — plus the rate rule, which is the one that quietly
 * rewrites history.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => {
  const state = { queries: [] as string[], results: [] as unknown[][], values: [] as unknown[][] };
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(strings.raw.join(' ? ').replace(/\s+/g, ' ').trim());
    state.values.push(values);
    const next = state.results.shift() ?? [];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };
  return { db: { sqlMock: Object.assign(tagged, { state, json: (v: unknown) => v }), state } };
});

vi.mock('@/lib/db', () => ({ sql: db.sqlMock, auditLog: vi.fn(async () => {}) }));
vi.mock('@/lib/events', () => ({
  emitEventSingle: vi.fn(async () => {}),
  userActor: (id: string) => ({ type: 'user', id }),
}));
vi.mock('@/lib/projects/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/access')>()),
  canAccessProject: vi.fn(async () => true),
}));

import { logTime, approveTime, deleteTimeEntry } from '@/lib/projects/time';
import { emitEventSingle } from '@/lib/events';

const ADMIN = { userId: 'u-admin', role: 'tenant_admin', tenantId: 't1' };
const EMPLOYEE = { userId: 'u-emp', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const NODE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ENTRY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const nodeRow = { id: NODE, code: '2.3', title: 'Monthly report — March' };
const entryRow = (o: Record<string, unknown> = {}) => ({
  id: ENTRY, projectId: PROJECT, wbsNodeId: NODE, taskId: null, userId: 'u-emp',
  workedOn: '2026-05-04', hours: '7.50', hourlyRate: '142.00', cost: '1065.00',
  note: null, approvedBy: null, approvedAt: null, ...o,
});

const good = { wbsNodeId: NODE, workedOn: '2026-05-04', hours: 7.5, hourlyRate: 142 };

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
});

// ── where the hours land ─────────────────────────────────────────────────────────────────────

describe('hours go to a WBS node, and nowhere else', () => {
  it('refuses an entry with no node, and says why', async () => {
    // Hours with no place in the work breakdown cannot roll up to a CLIN, and a cost measure that
    // silently dropped them would be worse than one reporting nothing.
    const r = await logTime(EMPLOYEE, PROJECT, { ...good, wbsNodeId: undefined });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cannot roll up to a CLIN/);
    expect(db.state.queries, 'refused before writing').toEqual([]);
  });

  it('REFUSES a node from another project — no FK stops it billing another customer', async () => {
    db.state.results = [[]];
    const r = await logTime(EMPLOYEE, PROJECT, good);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not belong to this project/);
  });

  it('scopes the node lookup by project AND tenant', async () => {
    db.state.results = [[]];
    await logTime(EMPLOYEE, PROJECT, good);
    const probe = db.state.queries.find((q) => /FROM project_wbs_nodes/i.test(q)) ?? '';
    expect(probe).toMatch(/project_id = \?/);
    expect(probe).toMatch(/tenant_id = \?/);
  });

  it('an optional task tag is checked against the same project', async () => {
    db.state.results = [[nodeRow], []];
    const r = await logTime(EMPLOYEE, PROJECT, { ...good, taskId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/task does not belong/);
  });
});

// ── the rate ─────────────────────────────────────────────────────────────────────────────────

describe('the rate is copied in, not looked up', () => {
  it('writes the rate given, and never queries a rate table', async () => {
    // Resolved later, history re-prices itself every time somebody gets a raise, and last year's
    // cost report stops matching last year's invoice.
    db.state.results = [[nodeRow], [entryRow()]];
    await logTime(EMPLOYEE, PROJECT, good);
    const i = db.state.queries.findIndex((q) => /INSERT INTO project_time_entries/i.test(q));
    expect(db.state.values[i]).toContain(142);
    expect(db.state.queries.some((q) => /rate_card|billing_rate|user_rates/i.test(q))).toBe(false);
  });

  it('never writes the cost — it is generated from hours × rate', async () => {
    db.state.results = [[nodeRow], [entryRow()]];
    await logTime(EMPLOYEE, PROJECT, good);
    const insert = db.state.queries.find((q) => /INSERT INTO project_time_entries/i.test(q)) ?? '';
    expect(insert.split(/\bRETURNING\b/i)[0]).not.toMatch(/\bcost\b/i);
  });

  it('accepts an entry with NO rate — hours are still hours', async () => {
    // A subcontractor's time, or a shop that does not price internally. It contributes 0 to cost
    // and its hours still count, which is honest.
    db.state.results = [[nodeRow], [entryRow({ hourlyRate: null, cost: '0.00' })]];
    const r = await logTime(EMPLOYEE, PROJECT, { ...good, hourlyRate: null });
    expect(r.ok).toBe(true);
  });
});

// ── the hours themselves ─────────────────────────────────────────────────────────────────────

describe('hours', () => {
  it('refuses more than 24 in a day', async () => {
    const r = await logTime(EMPLOYEE, PROJECT, { ...good, hours: 30 });
    expect(r.ok).toBe(false);
  });

  it('refuses zero and negatives', async () => {
    expect((await logTime(EMPLOYEE, PROJECT, { ...good, hours: 0 })).ok).toBe(false);
    expect((await logTime(EMPLOYEE, PROJECT, { ...good, hours: -3 })).ok).toBe(false);
  });

  it('refuses a missing or malformed date', async () => {
    const r = await logTime(EMPLOYEE, PROJECT, { ...good, workedOn: '4 May' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/YYYY-MM-DD/);
  });
});

// ── whose hours ──────────────────────────────────────────────────────────────────────────────

describe('logging on somebody else’s behalf', () => {
  it('is refused for an employee — a timesheet anybody can write in another name is not one', async () => {
    const r = await logTime(EMPLOYEE, PROJECT, { ...good, userId: 'u-other' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('is allowed for a tenant_admin, and the event says so', async () => {
    db.state.results = [[nodeRow], [entryRow({ userId: 'u-other' })]];
    const r = await logTime(ADMIN, PROJECT, { ...good, userId: 'u-other' });
    expect(r.ok).toBe(true);
    const ev = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'time.logged');
    expect((ev![0].payload as Record<string, unknown>).onBehalfOf).toBe('u-other');
  });
});

// ── approving ────────────────────────────────────────────────────────────────────────────────

describe('logging is not approving', () => {
  it('an employee cannot approve — approving is what turns hours into cost', async () => {
    const r = await approveTime(EMPLOYEE, PROJECT, [ENTRY]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(db.state.queries).toEqual([]);
  });

  it('approves MANY at once — a week of entries is read together', async () => {
    db.state.results = [[{ id: ENTRY, cost: '1065.00' }, { id: 'e2', cost: '284.00' }]];
    const r = await approveTime(ADMIN, PROJECT, [ENTRY, 'e2']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.approved).toBe(2);
  });

  it('re-approving cannot re-stamp who signed off', async () => {
    db.state.results = [[]];
    await approveTime(ADMIN, PROJECT, [ENTRY]);
    const upd = db.state.queries.find((q) => /UPDATE project_time_entries/i.test(q)) ?? '';
    expect(upd).toMatch(/approved_at IS NULL/i);
  });

  it('is scoped by project, so an id from elsewhere cannot ride in on the list', async () => {
    db.state.results = [[]];
    await approveTime(ADMIN, PROJECT, [ENTRY]);
    const upd = db.state.queries.find((q) => /UPDATE project_time_entries/i.test(q)) ?? '';
    expect(upd).toMatch(/project_id = \?/);
    expect(upd).toMatch(/tenant_id = \?/);
  });

  it('carries the approved COST on the event — what was signed off, not just how many rows', async () => {
    db.state.results = [[{ id: ENTRY, cost: '1065.00' }, { id: 'e2', cost: '284.00' }]];
    await approveTime(ADMIN, PROJECT, [ENTRY, 'e2']);
    const ev = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'time.approved');
    expect((ev![0].payload as Record<string, unknown>).cost).toBe(1349);
  });
});

// ── removing ─────────────────────────────────────────────────────────────────────────────────

describe('removing an entry', () => {
  it('refuses once APPROVED — those hours are a billing record', async () => {
    db.state.results = [[{ id: ENTRY, userId: 'u-emp', approvedAt: '2026-05-05' }]];
    const r = await deleteTimeEntry(EMPLOYEE, PROJECT, ENTRY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('ALREADY_APPROVED');
      expect(r.error).toMatch(/billing record/);
    }
  });

  it('refuses somebody else’s unapproved entry', async () => {
    db.state.results = [[{ id: ENTRY, userId: 'u-other', approvedAt: null }]];
    const r = await deleteTimeEntry(EMPLOYEE, PROJECT, ENTRY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('allows your own, while it is unapproved', async () => {
    db.state.results = [[{ id: ENTRY, userId: 'u-emp', approvedAt: null }], []];
    const r = await deleteTimeEntry(EMPLOYEE, PROJECT, ENTRY);
    expect(r.ok).toBe(true);
  });
});
