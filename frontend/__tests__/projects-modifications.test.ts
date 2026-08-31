/**
 * CONTRACT MODIFICATIONS — the only write path to a CLIN.
 *
 * The cases here are about the four things that make an amendment trustworthy: that drafting does
 * not apply, that executing applies once, that the OLD value recorded is the one that was actually
 * standing at the moment of execution, and that a signed mod cannot be edited afterwards.
 *
 * Plus the one that is a decision rather than a rule: **executing does not rebaseline.** A mod that
 * moves the period of performance raises a ToDo asking a person to do it. Two writers on the plan's
 * dates is how a schedule stops being explainable, and an automatic rebaseline would be the second.
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
  const client = Object.assign(tagged, { state, json: (v: unknown) => v });
  return { db: { sqlMock: client, state } };
});

vi.mock('@/lib/db', () => ({ sql: db.sqlMock, auditLog: vi.fn(async () => {}) }));
vi.mock('@/lib/rls', () => ({
  // The real `withTenant` opens a transaction; here it hands back the same recording client, so the
  // statements inside land in the same ordered list the assertions read.
  withTenant: async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(db.sqlMock),
}));
vi.mock('@/lib/events', () => ({
  emitEventSingle: vi.fn(async () => {}),
  userActor: (id: string) => ({ type: 'user', id }),
}));
vi.mock('@/lib/tasks/tasks', () => ({
  createTask: vi.fn(async () => ({ ok: true, data: { taskId: 'todo-1' } })),
}));
vi.mock('@/lib/projects/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/access')>()),
  canAccessProject: vi.fn(async () => true),
}));

import { draftModification, executeModification, deleteModification } from '@/lib/projects/modifications';
import { emitEventSingle } from '@/lib/events';
import { createTask } from '@/lib/tasks/tasks';

const ADMIN = { userId: 'u-admin', role: 'tenant_admin', tenantId: 't1' };
const EMPLOYEE = { userId: 'u-emp', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const CLIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MOD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DOC = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const modRow = (o: Record<string, unknown> = {}) => ({
  id: MOD, projectId: PROJECT, modNumber: 'P00001', title: 'Incremental funding',
  kind: 'funding', status: 'draft', executedOn: null, executedBy: null,
  sourceDocId: DOC, createdBy: 'u-admin', createdAt: '2026-05-01', ...o,
});

const fundingChange = { clinId: CLIN, field: 'funded_amount', newValue: 900000 };

/** Only the statements that WRITE, so an assertion cannot be satisfied by a SELECT. */
const writes = () => db.state.queries.filter((q) => /^(INSERT|UPDATE|DELETE)/i.test(q)).join(' ');

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
  vi.mocked(createTask).mockClear();
});

// ── drafting ─────────────────────────────────────────────────────────────────────────────────

describe('drafting a modification', () => {
  it('is refused for an employee — a mod moves the contract', async () => {
    const r = await draftModification(EMPLOYEE, PROJECT, {
      modNumber: 'P00001', title: 'x', changes: [fundingChange],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(db.state.queries, 'a role refusal must not reach the database').toEqual([]);
  });

  it('DOES NOT touch the CLIN — drafting is not executing', async () => {
    // The whole point of the draft state. A mod is written while it is being negotiated, and a
    // draft that moved the money would put unsigned numbers into the roll-up.
    db.state.results = [[{ id: CLIN }], [modRow()], []];
    const r = await draftModification(ADMIN, PROJECT, {
      modNumber: 'P00001', title: 'Incremental funding', changes: [fundingChange],
    });
    expect(r.ok).toBe(true);
    expect(writes()).not.toMatch(/UPDATE project_clins/i);
  });

  it('REFUSES a CLIN from another project — no FK stops it moving another customer’s money', async () => {
    db.state.results = [[]];   // the ownership probe finds nothing
    const r = await draftModification(ADMIN, PROJECT, {
      modNumber: 'P00001', title: 'x', changes: [fundingChange],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not belong to this project/);
    expect(writes()).toBe('');
  });

  it('scopes the CLIN ownership probe by project AND tenant', async () => {
    db.state.results = [[]];
    await draftModification(ADMIN, PROJECT, { modNumber: 'P1', title: 'x', changes: [fundingChange] });
    const probe = db.state.queries.find((q) => /FROM project_clins/i.test(q)) ?? '';
    expect(probe).toMatch(/project_id = \?/);
    expect(probe).toMatch(/tenant_id = \?/);
  });

  it('refuses a field that is not amendable, and lists the ones that are', async () => {
    db.state.results = [[{ id: CLIN }]];
    const r = await draftModification(ADMIN, PROJECT, {
      modNumber: 'P1', title: 'x', changes: [{ clinId: CLIN, field: 'tenant_id', newValue: 'other' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/not a field a modification can move/);
      expect(r.error, 'the message says what IS allowed').toMatch(/funded_amount/);
    }
  });

  it('refuses a non-administrative mod that changes nothing', async () => {
    const r = await draftModification(ADMIN, PROJECT, { modNumber: 'P1', title: 'x', kind: 'funding', changes: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/administrative/);
  });

  it('ALLOWS an administrative mod that changes nothing — a new CO is a real amendment', async () => {
    db.state.results = [[modRow({ kind: 'administrative' })]];
    const r = await draftModification(ADMIN, PROJECT, {
      modNumber: 'P00002', title: 'Change of contracting officer', kind: 'administrative', changes: [],
    });
    expect(r.ok).toBe(true);
  });

  it('refuses a malformed date rather than storing it as text', async () => {
    db.state.results = [[{ id: CLIN }]];
    const r = await draftModification(ADMIN, PROJECT, {
      modNumber: 'P1', title: 'x', changes: [{ clinId: CLIN, field: 'pop_end', newValue: '31 Dec' }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/YYYY-MM-DD/);
  });

  it('a duplicate mod number is a 409 that explains itself, not a raw constraint', async () => {
    db.state.results = [[{ id: CLIN }], Object.assign(new Error('dup'), { code: '23505' }) as never];
    const r = await draftModification(ADMIN, PROJECT, {
      modNumber: 'P00001', title: 'x', changes: [fundingChange],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.code).toBe('DUPLICATE_MOD_NUMBER');
    }
  });
});

// ── executing ────────────────────────────────────────────────────────────────────────────────

describe('executing a modification', () => {
  const readyToExecute = (over: Record<string, unknown> = {}) => {
    db.state.results = [
      [modRow(over)],                                   // the mod
      [{ id: DOC }],                                    // the signed document
      [{ id: 'ch1', action: 'amend', clinId: CLIN, field: 'funded_amount', newValue: '900000', payload: {}, sortIndex: 0 }],
      [{ title: 'Base', contractType: 'FFP', popStart: '2026-01-01', popEnd: '2026-12-31', fundedAmount: '750000.00' }],
      [],                                               // UPDATE project_clins
      [],                                               // UPDATE the change row
      [{ id: MOD }],                                    // the CAS flip
      [],                                               // provenance upsert
      [{ name: 'P', baselinedAt: '2026-03-01' }],       // the project, for the rebaseline question
    ];
  };

  it('requires an execution date — "when did the contract change" has no other answer later', async () => {
    const r = await executeModification(ADMIN, PROJECT, MOD, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/execution date/);
    expect(db.state.queries).toEqual([]);
  });

  it('REFUSES with no signed document — the new CLIN value has to cite something openable', async () => {
    db.state.results = [[modRow({ sourceDocId: null })]];
    const r = await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NO_SIGNED_DOCUMENT');
      expect(r.error).toMatch(/citation nobody can open/);
    }
    expect(writes()).not.toMatch(/UPDATE project_clins/i);
  });

  it('refuses to execute twice, legibly, before the trigger has to', async () => {
    db.state.results = [[modRow({ status: 'executed', executedOn: '2026-05-05' })]];
    const r = await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('ALREADY_EXECUTED');
      expect(r.error, 'and says what to do instead').toMatch(/another one/i);
    }
  });

  it('applies the change and moves the CLIN', async () => {
    readyToExecute();
    const r = await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.applied).toBe(1);
    expect(writes()).toMatch(/UPDATE project_clins SET funded_amount/i);
  });

  it('records the old value READ AT EXECUTION, not one carried from the draft', async () => {
    // A value read when the mod was drafted may have been moved by another mod executed in
    // between. Recording the stale one makes the history read as a change that never happened.
    readyToExecute();
    await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    const i = db.state.queries.findIndex((q) => /UPDATE project_modification_changes SET old_value/i.test(q));
    expect(i, 'the change row is stamped with an old value').toBeGreaterThan(-1);
    expect(db.state.values[i]).toContain('750000.00');

    // And the READ came before the WRITE, in that order — the whole reason it is two statements
    // rather than a subquery inside RETURNING.
    const read = db.state.queries.findIndex((q) => /SELECT title, contract_type/i.test(q));
    const write = db.state.queries.findIndex((q) => /UPDATE project_clins/i.test(q));
    expect(read).toBeGreaterThan(-1);
    expect(read).toBeLessThan(write);
  });

  it('claims the mod by compare-and-swap, so two executions cannot both apply', async () => {
    readyToExecute();
    await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    const flip = db.state.queries.find((q) => /UPDATE project_modifications/i.test(q)) ?? '';
    expect(flip).toMatch(/status = 'draft'/i);
  });

  it('rolls back rather than half-applying when the CAS loses', async () => {
    readyToExecute();
    db.state.results[6] = [];   // the flip matches nothing — somebody else executed it first
    const r = await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ALREADY_EXECUTED');
  });

  it('writes provenance CITING THE MOD, and SUPERSEDES the contract’s original citation', async () => {
    // The subtle one. `recordProvenance` upserts only when the new method OUTRANKS the existing —
    // so `verified` (the mod) replacing `verified` (the original contract) is refused by a guard
    // that compares METHOD and not RECENCY. The funded amount would move to $900,000 and the badge
    // would still read "Read from source", pointing at the contract page that says $750,000.
    //
    // `supersedes: true` is the named escape for exactly that, and this asserts it is passed —
    // without it the whole module writes a citation that is quietly false.
    readyToExecute();
    await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    const prov = db.state.queries.find((q) => /INSERT INTO project_provenance/i.test(q)) ?? '';
    expect(prov, 'the upsert is the shared helper, not a second copy').toMatch(/ON CONFLICT/i);
    const i = db.state.queries.indexOf(prov);
    expect(db.state.values[i], 'it cites the signed mod').toContain(DOC);
    expect(db.state.values[i], 'and drops the trust-order guard, which cannot see recency').toContain(true);
  });

  it('DOES NOT REBASELINE — it raises a ToDo asking a person to', async () => {
    // The decision this module is built around. An automatic rebaseline would be a second writer
    // on the plan's dates, and the baseline is the original promise.
    readyToExecute();
    db.state.results[2] = [{ id: 'ch1', action: 'amend', clinId: CLIN, field: 'pop_end', newValue: '2027-06-30', payload: {}, sortIndex: 0 }];
    const r = await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    expect(r.ok).toBe(true);

    expect(writes(), 'the frozen baseline is not in any statement').not.toMatch(/baseline_date|baseline_cost/i);
    expect(writes(), 'nor is the current plan moved behind a person’s back').not.toMatch(/UPDATE project_milestones/i);

    const todo = vi.mocked(createTask).mock.calls[0]?.[0];
    expect(todo?.title).toMatch(/Rebaseline/i);
    if (r.ok) expect(r.data.rebaselineTodoId).toBe('todo-1');
  });

  it('does NOT ask for a rebaseline on a project that has no baseline yet', async () => {
    // The question has no meaning before there is a promise to be out of step with, and a ToDo
    // nobody can action is how a queue becomes noise.
    readyToExecute();
    db.state.results[2] = [{ id: 'ch1', action: 'amend', clinId: CLIN, field: 'pop_end', newValue: '2027-06-30', payload: {}, sortIndex: 0 }];
    db.state.results[8] = [{ name: 'P', baselinedAt: null }];
    const r = await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    expect(r.ok).toBe(true);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('does not ask for a rebaseline when only the MONEY moved', async () => {
    readyToExecute();
    const r = await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    expect(r.ok).toBe(true);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('an option exercise creates the CLIN and points the change row at what it made', async () => {
    db.state.results = [
      [modRow({ kind: 'scope' })],
      [{ id: DOC }],
      [{ id: 'ch1', action: 'add_clin', clinId: null, field: null, newValue: null,
         payload: { clinNumber: '0003', title: 'Option II', fundedAmount: 400000 }, sortIndex: 0 }],
      [{ id: 'new-clin' }],                             // the INSERT
      [],                                               // the change row points at its own result
      [{ id: MOD }],
      [],
      [{ name: 'P', baselinedAt: '2026-03-01' }],
    ];
    const r = await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.clinsCreated).toBe(1);
    expect(writes()).toMatch(/INSERT INTO project_clins/i);
    const point = db.state.queries.find((q) => /UPDATE project_modification_changes SET clin_id/i.test(q));
    expect(point, 'the change row closes the trail to the CLIN it created').toBeTruthy();
  });

  it('carries what MOVED on the event, not just that it happened', async () => {
    readyToExecute();
    await executeModification(ADMIN, PROJECT, MOD, { executedOn: '2026-06-01' });
    const ev = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'modification.executed');
    const p = ev![0].payload as Record<string, unknown>;
    expect(p.modNumber).toBe('P00001');
    expect(p.applied).toBe(1);
    expect(p.executedOn).toBe('2026-06-01');
  });
});

// ── discarding ───────────────────────────────────────────────────────────────────────────────

describe('discarding', () => {
  it('a draft can be discarded', async () => {
    db.state.results = [[{ id: MOD, status: 'draft', modNumber: 'P00001' }], []];
    const r = await deleteModification(ADMIN, PROJECT, MOD);
    expect(r.ok).toBe(true);
    expect(writes()).toMatch(/DELETE FROM project_modifications/i);
  });

  it('an EXECUTED mod is refused — it is the record of what was agreed', async () => {
    db.state.results = [[{ id: MOD, status: 'executed', modNumber: 'P00001' }]];
    const r = await deleteModification(ADMIN, PROJECT, MOD);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('MODIFICATION_EXECUTED');
      expect(r.error).toMatch(/another modification/i);
    }
    expect(writes()).toBe('');
  });
});
