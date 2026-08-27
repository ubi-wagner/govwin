/**
 * TASK SPINE V2 — the rules that are easy to state and easy to get subtly wrong (mig 221).
 *
 * The schema invariants themselves live in the DATABASE and are exercised against a real Postgres
 * by the lifecycle drive: a trigger cannot be unit-tested against a mock, and asserting that our
 * code *would* refuse something proves nothing about whether the database does. What is tested here
 * is everything on the TypeScript side of that boundary:
 *
 *   · scope is DERIVED from whether a milestone was named, never taken from the caller
 *   · `null` means "clear it" and absent means "leave it" — the distinction the whole patch rests on
 *   · a date change resets the nudge watermark; a no-op save does NOT
 *   · reassignment closes the old ToDo and raises the new one — the projection follows
 *   · the due date is constrained, the ESTIMATE is not
 *   · the cascade follows declared successors, and falls back to serial order when none exist
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => {
  const state = { queries: [] as string[], results: [] as unknown[][], values: [] as unknown[][] };
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(strings.raw.join(' ? ').replace(/\s+/g, ' ').trim());
    state.values.push(values);
    const next = state.results.shift() ?? [];
    // An Error queued in `results` REJECTS. That is how a database trigger is simulated: mig 221's
    // rules are raised by Postgres, and the only thing the TypeScript side owns is turning that
    // SQLSTATE into a sentence — which cannot be tested without something that throws one.
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
vi.mock('@/lib/projects/todos', () => ({
  raiseTaskTodo: vi.fn(async () => 'todo-1'),
  closeTaskTodos: vi.fn(async () => 1),
  closeTodosUnder: vi.fn(async () => 0),
}));

import { createMilestoneTask, updateTask, rescheduleMilestone } from '@/lib/projects/milestone-tasks';
import { emitEventSingle } from '@/lib/events';
import { raiseTaskTodo, closeTaskTodos } from '@/lib/projects/todos';

const ADMIN = { userId: 'u1', role: 'tenant_admin', tenantId: 't1' };
const EMPLOYEE = { userId: 'u2', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const MILESTONE = '55555555-5555-4555-8555-555555555555';
const TASK = '66666666-6666-4666-8666-666666666666';

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
  vi.mocked(raiseTaskTodo).mockClear();
  vi.mocked(closeTaskTodos).mockClear();
});

/** The values handed to the statement that matches — selected by what it IS, never by position. */
const valuesOf = (re: RegExp) => {
  const i = db.state.queries.findIndex((q) => re.test(q));
  expect(i, `no statement matched ${re}`).toBeGreaterThan(-1);
  return db.state.values[i];
};

// ── scope is derived, never trusted ──────────────────────────────────────────────────────────

describe('scope is DERIVED from the milestone, not taken from the caller', () => {
  it("a task with a milestone is scope 'milestone'", async () => {
    db.state.results = [[{ id: MILESTONE }], [{ id: TASK, milestoneId: MILESTONE, scope: 'milestone' }], []];
    const r = await createMilestoneTask(ADMIN, PROJECT, { milestoneId: MILESTONE, title: 'CDR pack' });
    expect(r.ok).toBe(true);
    expect(valuesOf(/INSERT INTO project_milestone_tasks/i)).toContain('milestone');
  });

  it("a task with NO milestone is scope 'project', and is not refused for a missing field", async () => {
    // Standing work is a first-class case, not an incomplete milestone task. Before mig 221 the
    // route rejected this outright with "milestoneId is required".
    db.state.results = [[{ id: TASK, milestoneId: null, scope: 'project' }], []];
    const r = await createMilestoneTask(ADMIN, PROJECT, { title: 'Keep the risk register current' });
    expect(r.ok).toBe(true);
    const v = valuesOf(/INSERT INTO project_milestone_tasks/i);
    expect(v).toContain('project');
    expect(v, 'the milestone slot is null, not a stand-in id').toContain(null);
  });

  it('a project-scope task never queries a milestone it does not have', async () => {
    db.state.results = [[{ id: TASK, milestoneId: null, scope: 'project' }], []];
    await createMilestoneTask(ADMIN, PROJECT, { title: 'standing' });
    expect(db.state.queries.some((q) => /FROM project_milestones/i.test(q)),
      'a NULL milestone must not be looked up — the FK check is for a named one').toBe(false);
  });
});

// ── null means clear, absent means leave ─────────────────────────────────────────────────────

describe('updateTask — `null` is a meaning, absence is not', () => {
  const before = {
    id: TASK, projectId: PROJECT, milestoneId: MILESTONE, scope: 'milestone', title: 'CDR pack',
    detail: 'as discussed', assigneeUserId: 'u2', assigneeRole: null,
    dueDate: new Date('2026-06-30T00:00:00Z'), estimatedCompletion: null,
    status: 'open', blockedReason: null, completedAt: null, completedBy: null,
    sortIndex: 0, nudgesSent: 2,
  };
  const after = (o: Record<string, unknown> = {}) => [{ ...before, ...o }];

  it('an explicit null UNASSIGNS; it does not read as "leave the owner alone"', async () => {
    db.state.results = [[before], after({ assigneeUserId: null })];
    const r = await updateTask(ADMIN, PROJECT, TASK, { assigneeUserId: null });
    expect(r.ok).toBe(true);
    expect(valuesOf(/UPDATE project_milestone_tasks/i)).toContain(null);
  });

  it('a patch that names only the note leaves the dates and the owner where they were', async () => {
    db.state.results = [[before], after({ detail: 'new note' })];
    await updateTask(EMPLOYEE, PROJECT, TASK, { detail: 'new note' });
    const v = valuesOf(/UPDATE project_milestone_tasks/i);
    expect(v, 'the existing owner is carried, not blanked').toContain('u2');
    expect(v).toContain('new note');
  });

  it('naming a PERSON clears the role bucket — they are alternatives, not a pair', async () => {
    db.state.results = [
      [{ ...before, assigneeUserId: null, assigneeRole: 'tenant_user' }],
      [{ id: 'u2' }],
      after({ assigneeUserId: 'u2', assigneeRole: null }),
    ];
    await updateTask(ADMIN, PROJECT, TASK, { assigneeUserId: 'u2', assigneeRole: 'tenant_user' });
    const v = valuesOf(/UPDATE project_milestone_tasks/i);
    expect(v).toContain('u2');
    expect(v, 'a task addressed to both a person and a bucket lands twice').not.toContain('tenant_user');
  });
});

// ── the nudge watermark ──────────────────────────────────────────────────────────────────────

describe('rescheduling resets the nudge watermark — and a no-op save does not', () => {
  const before = {
    id: TASK, projectId: PROJECT, milestoneId: MILESTONE, scope: 'milestone', title: 'CDR pack',
    detail: null, assigneeUserId: 'u2', assigneeRole: null,
    dueDate: new Date('2026-06-30T00:00:00Z'), estimatedCompletion: null,
    status: 'open', blockedReason: null, completedAt: null, completedBy: null,
    sortIndex: 0, nudgesSent: 2,
  };

  it('a moved date resets nudges_sent to 0, so the sweeper re-fires against the new due', async () => {
    db.state.results = [[before], [{ ...before, dueDate: new Date('2026-07-14T00:00:00Z') }]];
    await updateTask(ADMIN, PROJECT, TASK, { dueDate: '2026-07-14' });
    expect(valuesOf(/UPDATE project_milestone_tasks/i)).toContain(0);
  });

  it('SAVING THE SAME DATE keeps the watermark — a Date is not its ISO string', async () => {
    // The trap this guards: `before.dueDate` is a JavaScript Date and the caller sends
    // '2026-06-30'. Comparing them directly is ALWAYS "different", so every save would reset the
    // watermark and re-raise a ToDo — a nudge storm produced by pressing save twice.
    db.state.results = [[before], [before]];
    await updateTask(ADMIN, PROJECT, TASK, { dueDate: '2026-06-30' });
    expect(valuesOf(/UPDATE project_milestone_tasks/i)).toContain(2);
    expect(vi.mocked(closeTaskTodos), 'nothing moved, so nothing is re-projected').not.toHaveBeenCalled();
  });
});

// ── the projection follows the checklist ─────────────────────────────────────────────────────

describe('the ToDo projection follows a reassignment', () => {
  const before = {
    id: TASK, projectId: PROJECT, milestoneId: MILESTONE, scope: 'milestone', title: 'CDR pack',
    detail: null, assigneeUserId: 'u2', assigneeRole: null,
    dueDate: new Date('2026-06-30T00:00:00Z'), estimatedCompletion: null,
    status: 'open', blockedReason: null, completedAt: null, completedBy: null,
    sortIndex: 0, nudgesSent: 0,
  };

  it("closes the previous holder's ToDo and raises one for the new owner", async () => {
    // Leaving the old one open keeps finished-for-them work in somebody's queue, which is how a
    // queue stops being believed.
    db.state.results = [[before], [{ id: 'u3' }], [{ ...before, assigneeUserId: 'u3' }], [{ name: 'Phase II' }]];
    await updateTask(ADMIN, PROJECT, TASK, { assigneeUserId: 'u3' });
    expect(vi.mocked(closeTaskTodos)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(raiseTaskTodo)).toHaveBeenCalledTimes(1);
  });

  it('emits task.reassigned carrying who it moved from and to', async () => {
    db.state.results = [[before], [{ id: 'u3' }], [{ ...before, assigneeUserId: 'u3' }], [{ name: 'Phase II' }]];
    await updateTask(ADMIN, PROJECT, TASK, { assigneeUserId: 'u3' });
    const call = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'task.reassigned');
    expect(call, 'open editing means audited, not untracked').toBeTruthy();
    const payload = call![0].payload as Record<string, unknown>;
    expect(payload.from).toBe('u2');
    expect(payload.to).toBe('u3');
  });

  it('refuses to hand work to somebody who is not on the project', async () => {
    // Granting project access as a side effect of a reassignment form would make the boundary
    // stop meaning anything — the same refusal `createMilestoneTask` gives.
    db.state.results = [[before], []];
    const r = await updateTask(ADMIN, PROJECT, TASK, { assigneeUserId: 'stranger' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_ON_PROJECT');
  });

  it('an EMPLOYEE may rearrange — it is the work, not a management act', async () => {
    db.state.results = [[before], [{ id: 'u3' }], [{ ...before, assigneeUserId: 'u3' }], [{ name: 'Phase II' }]];
    const r = await updateTask(EMPLOYEE, PROJECT, TASK, { assigneeUserId: 'u3' });
    expect(r.ok).toBe(true);
  });
});

// ── the estimate is not the commitment ───────────────────────────────────────────────────────

describe('the due date is constrained; the ESTIMATE is not', () => {
  const before = {
    id: TASK, projectId: PROJECT, milestoneId: MILESTONE, scope: 'milestone', title: 'CDR pack',
    detail: null, assigneeUserId: 'u2', assigneeRole: null,
    dueDate: new Date('2026-06-30T00:00:00Z'), estimatedCompletion: null,
    status: 'open', blockedReason: null, completedAt: null, completedBy: null,
    sortIndex: 0, nudgesSent: 0,
  };

  it('accepts an estimate that runs PAST the due date — that gap is the warning', async () => {
    // If this were refused, people would learn to enter the date that is accepted rather than the
    // one they believe, and the early warning the column exists for would disappear.
    db.state.results = [[before], [{ ...before, estimatedCompletion: new Date('2026-09-01T00:00:00Z') }]];
    const r = await updateTask(EMPLOYEE, PROJECT, TASK, { estimatedCompletion: '2026-09-01' });
    expect(r.ok).toBe(true);
  });

  it('changing ONLY the estimate does not re-project the ToDo', async () => {
    // The ToDo carries the DUE date. Re-raising it because a forecast moved would nudge people
    // about a deadline that did not change.
    db.state.results = [[before], [{ ...before, estimatedCompletion: new Date('2026-09-01T00:00:00Z') }]];
    await updateTask(EMPLOYEE, PROJECT, TASK, { estimatedCompletion: '2026-09-01' });
    expect(vi.mocked(raiseTaskTodo)).not.toHaveBeenCalled();
  });

  it('maps the database refusal for a due date past the milestone into a sentence', async () => {
    // The RULE lives in the trigger and is exercised against real Postgres by the drive. What is
    // tested here is the only part TypeScript owns: turning SQLSTATE 23004 into something a person
    // can act on, rather than letting a constraint name reach the screen as a 500.
    const raised = Object.assign(
      new Error('Task "CDR pack" is due 2026-07-15 — after its milestone (2026-06-30)'),
      { code: '23004' },
    );
    db.state.results = [[before], raised as unknown as unknown[]];
    const r = await updateTask(ADMIN, PROJECT, TASK, { dueDate: '2026-07-15' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status, 'a refused plan change is a conflict, not a server fault').toBe(409);
      expect(r.code).toBe('DUE_AFTER_MILESTONE');
      expect(r.error).toMatch(/after its milestone/);
      expect(r.error, 'and it says what to do next').toMatch(/Move the milestone first/);
    }
  });

  it('maps the pull-in refusal, naming the tasks rather than moving them', async () => {
    const raised = Object.assign(
      new Error('2 task(s) would be due after the new date: CDR pack, Vendor lead times'),
      { code: '23005' },
    );
    db.state.results = [
      [{ id: 'm1', title: 'A', startsOn: null, forecastDate: new Date('2026-06-30T00:00:00Z'), baselineDate: null, status: 'pending', sortIndex: 1 }],
      raised as unknown as unknown[],
    ];
    const r = await rescheduleMilestone(ADMIN, PROJECT, 'm1', '2026-06-01');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('TASKS_WOULD_STRAND');
      expect(r.error, 'it names them — "not ready" tells nobody what to go and do')
        .toMatch(/CDR pack/);
      expect(r.error).toMatch(/does not move dates people committed to/);
    }
  });
});

// ── the cascade ──────────────────────────────────────────────────────────────────────────────

describe('rescheduleMilestone — declared successors, or the serial fallback', () => {
  const chain = (deps: Record<string, string | null>) => ([
    { id: 'm1', title: 'A', startsOn: null, forecastDate: new Date('2026-03-01T00:00:00Z'), baselineDate: null, status: 'pending', sortIndex: 1, dependsOnId: deps.m1 ?? null },
    { id: 'm2', title: 'B', startsOn: null, forecastDate: new Date('2026-04-01T00:00:00Z'), baselineDate: null, status: 'pending', sortIndex: 2, dependsOnId: deps.m2 ?? null },
    { id: 'm3', title: 'C', startsOn: null, forecastDate: new Date('2026-05-01T00:00:00Z'), baselineDate: null, status: 'pending', sortIndex: 3, dependsOnId: deps.m3 ?? null },
  ]);
  const target = chain({})[0];

  it('with NO dependency declared, everything later moves — identical to the pre-221 behaviour', async () => {
    db.state.results = [[target], [], chain({}), [], []];
    const r = await rescheduleMilestone(ADMIN, PROJECT, 'm1', '2026-03-15');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.moved, 'the target plus both later ones').toBe(3);
  });

  it('with dependencies declared, only DECLARED successors move — a parallel phase stays put', async () => {
    // m2 follows m1; m3 follows nothing and runs in parallel. Before mig 221 m3 moved too, purely
    // because its sort_index was higher — a plan slipping work that had no reason to slip.
    db.state.results = [[target], [], chain({ m2: 'm1' }), []];
    const r = await rescheduleMilestone(ADMIN, PROJECT, 'm1', '2026-03-15');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.moved, 'the target and m2 only').toBe(2);
  });

  it('follows a chain transitively', async () => {
    db.state.results = [[target], [], chain({ m2: 'm1', m3: 'm2' }), [], []];
    const r = await rescheduleMilestone(ADMIN, PROJECT, 'm1', '2026-03-15');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.moved).toBe(3);
  });
});
