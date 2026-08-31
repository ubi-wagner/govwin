/**
 * THE REGISTER — and the history a program review actually asks for.
 *
 * The question in every review is not "what are the risks" (a list answers that) but **"when did we
 * know, and what did we rate it?"** Two tables — one for risks, one for issues — answer neither: the
 * transition becomes a copy, and a copied row cannot say when the original was raised or what score
 * it carried at the time.
 *
 * So the cases here are about the transition and the arithmetic, not about CRUD.
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
vi.mock('@/lib/projects/milestone-tasks', () => ({
  createMilestoneTask: vi.fn(async () => ({ ok: true, data: { id: 'task-1' } })),
}));
vi.mock('@/lib/projects/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/access')>()),
  canAccessProject: vi.fn(async () => true),
  listAssignees: vi.fn(async () => [{ userId: 'u-emp', email: 'sam@acme.test', name: 'Sam', assignedAt: '' }]),
}));

import { raiseRisk, updateRisk, raiseAsIssue, closeRisk, mitigationTask } from '@/lib/projects/risks';
import { emitEventSingle } from '@/lib/events';
import { createMilestoneTask } from '@/lib/projects/milestone-tasks';

const ADMIN = { userId: 'u-admin', role: 'tenant_admin', tenantId: 't1' };
const EMPLOYEE = { userId: 'u-emp', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const RISK = '99999999-9999-4999-8999-999999999999';

const risk = (o: Record<string, unknown> = {}) => ({
  id: RISK, projectId: PROJECT, milestoneId: null, title: 'Rig vendor lead time slips',
  detail: null, kind: 'risk', status: 'open', probability: 4, impact: 5, score: 20,
  ownerUserId: null, mitigation: null, contingency: null, reviewOn: null,
  becameIssueAt: null, closedAt: null, closedNote: null, createdAt: 'x', ...o,
});

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
  vi.mocked(createMilestoneTask).mockClear();
});

/**
 * The part of a statement that WRITES, i.e. everything before RETURNING.
 *
 * Both of the assertions below first matched the RETURNING clause and reported a defect that was
 * not there: `INSERT … RETURNING …, score, …` contains the word "score" without writing it. What
 * is being asked is what the statement SETS, so that is what is searched.
 */
const written = (re: RegExp) => {
  const q = db.state.queries.find((x) => re.test(x)) ?? '';
  return q.split(/\bRETURNING\b/i)[0];
};

const insertValues = () => {
  const i = db.state.queries.findIndex((q) => /INSERT INTO project_risks/i.test(q));
  expect(i, 'a risk was inserted').toBeGreaterThan(-1);
  return db.state.values[i];
};

// ── raising ──────────────────────────────────────────────────────────────────────────────────

describe('raising', () => {
  it('an EMPLOYEE can raise one — the person who sees it first is rarely the manager', async () => {
    db.state.results = [[risk()]];
    const r = await raiseRisk(EMPLOYEE, PROJECT, { title: 'Rig vendor lead time slips', probability: 4, impact: 5 });
    expect(r.ok).toBe(true);
  });

  it('NEVER writes the score — it is generated from the two numbers beside it', async () => {
    // A score somebody computed in the UI goes stale the day the formula changes, and nothing
    // says which rows are which.
    db.state.results = [[risk()]];
    await raiseRisk(EMPLOYEE, PROJECT, { title: 'x', probability: 4, impact: 5 });
    expect(written(/INSERT INTO project_risks/i)).not.toMatch(/\bscore\b/i);
  });

  it('refuses a rating outside 1–5 rather than clamping it', async () => {
    const r = await raiseRisk(EMPLOYEE, PROJECT, { title: 'x', probability: 9, impact: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/1 to 5/);
    expect(db.state.queries, 'refused before writing').toEqual([]);
  });

  it('refuses a fractional rating — a judgement is a whole number here', async () => {
    const r = await raiseRisk(EMPLOYEE, PROJECT, { title: 'x', probability: 2.5, impact: 3 });
    expect(r.ok).toBe(false);
  });

  it('refuses an owner who is not on the project', async () => {
    const r = await raiseRisk(EMPLOYEE, PROJECT, { title: 'x', ownerUserId: 'u-stranger' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_ON_PROJECT');
  });

  it('logging something that ALREADY happened stamps the moment, in the same write', async () => {
    // mig 225's CHECK binds kind to became_issue_at, so they are computed together rather than
    // left to agree.
    db.state.results = [[risk({ kind: 'issue', becameIssueAt: 'x' })]];
    await raiseRisk(EMPLOYEE, PROJECT, { title: 'Vendor already missed the date', asIssue: true });
    const v = insertValues();
    expect(v).toContain('issue');
    expect(v.some((x) => x instanceof Date), 'a real timestamp, computed in JS').toBe(true);
  });
});

// ── the transition ───────────────────────────────────────────────────────────────────────────

describe('a risk becoming an issue is ONE row, moved', () => {
  it('updates in place — no insert, no copy', async () => {
    db.state.results = [[risk({ kind: 'issue', becameIssueAt: 'x' })]];
    const r = await raiseAsIssue(EMPLOYEE, PROJECT, RISK);
    expect(r.ok).toBe(true);
    expect(db.state.queries.some((q) => /INSERT INTO project_risks/i.test(q)),
      'a copy cannot answer "when did we raise it"').toBe(false);
  });

  it('does NOT touch probability or impact — "we rated this a 20 and it landed" is the point', async () => {
    db.state.results = [[risk({ kind: 'issue', becameIssueAt: 'x' })]];
    await raiseAsIssue(EMPLOYEE, PROJECT, RISK);
    const upd = written(/UPDATE project_risks/i);
    expect(upd).not.toMatch(/probability/i);
    expect(upd).not.toMatch(/impact/i);
  });

  it('rides a compare-and-swap on kind, so a second click cannot re-stamp when we learned', async () => {
    db.state.results = [[]];
    const r = await raiseAsIssue(EMPLOYEE, PROJECT, RISK);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ALREADY_AN_ISSUE');
    expect(written(/UPDATE project_risks/i)).toMatch(/kind = 'risk'/i);
  });
});

// ── rescoring ────────────────────────────────────────────────────────────────────────────────

describe('rescoring', () => {
  it('emits only when the SCORE actually moved', async () => {
    // A register that emits on every keystroke is a feed people mute.
    db.state.results = [[risk()], [risk({ mitigation: 'Order long-lead parts now' })]];
    await updateRisk(EMPLOYEE, PROJECT, RISK, { mitigation: 'Order long-lead parts now' });
    expect(vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'risk.rescored')).toBeUndefined();
  });

  it('and does emit when it did', async () => {
    db.state.results = [[risk()], [risk({ probability: 2, score: 10 })]];
    await updateRisk(EMPLOYEE, PROJECT, RISK, { probability: 2 });
    const ev = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'risk.rescored');
    expect(ev).toBeTruthy();
    const payload = ev![0].payload as Record<string, unknown>;
    expect(payload.from).toBe(20);
    expect(payload.to).toBe(10);
  });

  it('a patch that names only the mitigation leaves the ratings alone', async () => {
    db.state.results = [[risk()], [risk()]];
    await updateRisk(EMPLOYEE, PROJECT, RISK, { mitigation: 'x' });
    const i = db.state.queries.findIndex((q) => /UPDATE project_risks/i.test(q));
    expect(db.state.values[i]).toContain(4);   // probability carried, not blanked
    expect(db.state.values[i]).toContain(5);   // impact carried
  });
});

// ── closing ──────────────────────────────────────────────────────────────────────────────────

describe('closing', () => {
  it('is tenant_admin — deciding a risk is behind us is a management call', async () => {
    const r = await closeRisk(EMPLOYEE, PROJECT, RISK, 'parts arrived');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('a closed ISSUE is still an issue — kind and status are separate axes', async () => {
    db.state.results = [[risk({ kind: 'issue', status: 'closed', closedAt: 'x' })]];
    const r = await closeRisk(ADMIN, PROJECT, RISK, 'absorbed the slip');
    expect(r.ok).toBe(true);
    const ev = vi.mocked(emitEventSingle).mock.calls.find((c) => /closed/.test(String(c[0].type)));
    expect(ev![0].type, 'a mitigated risk and a survived issue are different news').toBe('issue.closed');
  });
});

// ── mitigations ──────────────────────────────────────────────────────────────────────────────

describe('a mitigation is a real task, not a private checklist', () => {
  it('creates a project-scope task on the existing spine', async () => {
    // It inherits the ToDo, the email, the nudges, reassignment and attachments. A second
    // checklist here would give a customer two places their work lives.
    db.state.results = [[{ id: RISK, title: 'Rig vendor lead time slips', mitigation: 'Order long-lead parts' }]];
    const r = await mitigationTask(ADMIN, PROJECT, RISK, { assigneeUserId: 'u-emp', dueDate: '2026-06-01' });
    expect(r.ok).toBe(true);
    const opts = vi.mocked(createMilestoneTask).mock.calls[0][2];
    expect(opts.milestoneId, 'standing work, not filed under a phase it does not gate').toBeNull();
    expect(opts.title).toBe('Order long-lead parts');
  });

  it('falls back to naming the risk when no mitigation was written', async () => {
    db.state.results = [[{ id: RISK, title: 'Rig vendor lead time slips', mitigation: null }]];
    await mitigationTask(ADMIN, PROJECT, RISK, {});
    expect(vi.mocked(createMilestoneTask).mock.calls[0][2].title).toBe('Mitigate: Rig vendor lead time slips');
  });
});
