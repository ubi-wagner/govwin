/**
 * THE CONVERSATION — the rules that stop a comment from being a diary.
 *
 * The parser has its own file (`projects-mentions.test.ts`). What is here is everything the domain
 * layer decides on top of it, and each case is written from a way this feature fails QUIETLY:
 *
 *   · a comment anchored to another contract's milestone — no FK exists to stop it
 *   · a mention that notifies somebody who cannot open the project
 *   · a resolved thread leaving a mention in somebody's queue forever
 *   · a reply nesting four deep and rendering as a wall
 *   · one person editing another's words
 *
 * None of those produce an error. All of them produce a comment that saved.
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
vi.mock('@/lib/tasks/tasks', () => ({
  createTask: vi.fn(async () => ({ ok: true, data: { taskId: 'todo-1' } })),
}));

const roster = vi.fn(async () => [
  { userId: 'u-dana', email: 'dana@acme.test', name: 'Dana', assignedAt: '' },
  { userId: 'u-sam', email: 'sam@acme.test', name: 'Sam', assignedAt: '' },
]);
vi.mock('@/lib/projects/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/access')>()),
  canAccessProject: vi.fn(async () => true),
  listAssignees: (...args: unknown[]) => roster(...(args as [])),
}));

import { postComment, setCommentResolved, editComment } from '@/lib/projects/comments';
import { emitEventSingle } from '@/lib/events';
import { createTask } from '@/lib/tasks/tasks';

const SAM = { userId: 'u-sam', role: 'tenant_user', tenantId: 't1' };
const ADMIN = { userId: 'u-dana', role: 'tenant_admin', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const MILESTONE = '55555555-5555-4555-8555-555555555555';
const COMMENT = '77777777-7777-4777-8777-777777777777';

const row = (o: Record<string, unknown> = {}) => ({
  id: COMMENT, projectId: PROJECT, entityType: 'project', entityId: null, parentId: null,
  body: 'a question', authorUserId: 'u-sam', mentions: [], resolvedAt: null, resolvedBy: null,
  editedAt: null, createdAt: '2026-05-01T00:00:00.000Z', ...o,
});

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
  vi.mocked(createTask).mockClear();
});

const insertValues = () => {
  const i = db.state.queries.findIndex((q) => /INSERT INTO project_comments/i.test(q));
  expect(i, 'the comment was inserted').toBeGreaterThan(-1);
  return db.state.values[i];
};

// ── the anchor ───────────────────────────────────────────────────────────────────────────────

describe('the anchor is validated, because no FK can', () => {
  it('a project-level comment writes a NULL entity_id and checks no table', async () => {
    // No anchor lookup, and the roster is mocked, so the INSERT is the first statement.
    db.state.results = [[row()]];
    const r = await postComment(SAM, PROJECT, { body: 'how is the rig?' });
    expect(r.ok).toBe(true);
    expect(db.state.queries.some((q) => /FROM project_milestones/i.test(q)),
      'nothing to look up when the anchor is the project itself').toBe(false);
  });

  it("REFUSES a milestone from another project — the check no database constraint performs", async () => {
    // entity_id has no FK: it points at four tables. This lookup is the only thing between a
    // comment and another customer's contract, so it is asserted directly.
    db.state.results = [[]];                       // the scoped milestone lookup finds nothing
    const r = await postComment(SAM, PROJECT, { entityType: 'milestone', entityId: MILESTONE, body: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toMatch(/does not belong to this project/);
    }
    expect(db.state.queries.some((q) => /INSERT INTO project_comments/i.test(q)),
      'and nothing is written').toBe(false);
  });

  it('the milestone lookup is scoped by project AND tenant, not by id alone', async () => {
    db.state.results = [[]];
    await postComment(SAM, PROJECT, { entityType: 'milestone', entityId: MILESTONE, body: 'x' });
    const probe = db.state.queries.find((q) => /FROM project_milestones/i.test(q)) ?? '';
    expect(probe).toMatch(/project_id = \?/);
    expect(probe).toMatch(/tenant_id = \?/);
  });

  it('refuses an anchor kind it does not know', async () => {
    const r = await postComment(SAM, PROJECT, { entityType: 'risk', entityId: MILESTONE, body: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION_ERROR');
    expect(db.state.queries, 'refused before touching the database').toEqual([]);
  });

  it('refuses an anchored comment that names no row', async () => {
    const r = await postComment(SAM, PROJECT, { entityType: 'task', entityId: null, body: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/has to say which one/);
  });
});

// ── mentions ─────────────────────────────────────────────────────────────────────────────────

describe('a mention reaches somebody, or says it did not', () => {
  it('raises a ToDo and asks for an email through the ONE seam', async () => {
    db.state.results = [[row({ mentions: ['u-dana'] })], [{ name: 'Phase II' }]];
    const r = await postComment(SAM, PROJECT, { body: 'over to @dana@acme.test' });
    expect(r.ok).toBe(true);
    expect(vi.mocked(createTask)).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(emitEventSingle).mock.calls
      .find((c) => c[0].type === 'notification.requested');
    expect(mail, 'never a direct send').toBeTruthy();
    expect((mail![0].payload as Record<string, unknown>).template).toBe('project_comment_mention');
  });

  it('the mention ToDo carries NO due date — it is a request to look, not a deadline', async () => {
    db.state.results = [[row({ mentions: ['u-dana'] })], [{ name: 'Phase II' }]];
    await postComment(SAM, PROJECT, { body: 'over to @dana@acme.test' });
    const opts = vi.mocked(createTask).mock.calls[0][0];
    expect(opts.dueAt).toBeNull();
    expect(opts.nudgeDays, 'chasing somebody about a comment is how a queue gets muted').toBeUndefined();
    expect(opts.entityType, 'it points at the COMMENT so resolving can close it').toBe('project_comment');
  });

  it('stores the RESOLVED ids, so "mentions me" never re-parses the text', async () => {
    db.state.results = [[row({ mentions: ['u-dana'] })], [{ name: 'Phase II' }]];
    await postComment(SAM, PROJECT, { body: '@dana@acme.test' });
    expect(insertValues().some((v) => Array.isArray(v) && v.includes('u-dana'))).toBe(true);
  });

  it('somebody NOT on the project is reported back, not notified', async () => {
    db.state.results = [[row()]];
    const r = await postComment(SAM, PROJECT, { body: 'asking @stranger@other.test' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.notified).toEqual([]);
      expect(r.data.unmatched, 'the UI has to be able to say so').toEqual(['stranger@other.test']);
    }
    expect(vi.mocked(createTask), 'notifying them would point at a page they are refused')
      .not.toHaveBeenCalled();
  });

  it('a comment survives a notification that fails — words are not lost to a ToDo', async () => {
    vi.mocked(createTask).mockRejectedValueOnce(new Error('queue down'));
    db.state.results = [[row({ mentions: ['u-dana'] })], [{ name: 'Phase II' }]];
    const r = await postComment(SAM, PROJECT, { body: '@dana@acme.test' });
    expect(r.ok).toBe(true);
  });
});

// ── threads ──────────────────────────────────────────────────────────────────────────────────

describe('threads are one level', () => {
  it('a reply to a reply attaches to the ROOT, rather than being refused mid-conversation', async () => {
    db.state.results = [
      [{ id: 'reply-1', parentId: 'root-1' }],     // the parent is itself a reply
      [row({ parentId: 'root-1' })],
    ];
    await postComment(SAM, PROJECT, { parentId: 'reply-1', body: 'and another thing' });
    expect(insertValues()).toContain('root-1');
    expect(insertValues(), 'not nested under the reply').not.toContain('reply-1');
  });

  it('refuses a parent from another project', async () => {
    db.state.results = [[]];
    const r = await postComment(SAM, PROJECT, { parentId: 'elsewhere', body: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_FOUND');
  });
});

// ── resolution ───────────────────────────────────────────────────────────────────────────────

describe('resolving closes the queue behind it', () => {
  it('records WHO and WHEN, not a bare boolean', async () => {
    db.state.results = [[row({ resolvedAt: '2026-05-02T00:00:00.000Z', resolvedBy: 'u-dana' })], []];
    const r = await setCommentResolved(ADMIN, PROJECT, COMMENT, true);
    expect(r.ok).toBe(true);
    const i = db.state.queries.findIndex((q) => /UPDATE project_comments/i.test(q));
    expect(db.state.values[i]).toContain('u-dana');
    expect(db.state.values[i].some((v) => v instanceof Date), 'a real timestamp, computed in JS').toBe(true);
  });

  it('closes the mention ToDos standing against it', async () => {
    // A finished conversation must not leave work in somebody's queue — the same sweep-up a closed
    // milestone does.
    //
    // It retires the rows DIRECTLY rather than through `completeTask`, which refuses anyone who is
    // not the assignee: a mention is addressed to somebody else by definition, so routing the
    // sweep through it left the ToDo open forever. Asserted on the statement, since that is now
    // what does the work.
    db.state.results = [
      [row({ resolvedAt: 'x', resolvedBy: 'u-dana' })],
      [{ id: 'todo-1' }, { id: 'todo-2' }],
      [{ id: 'todo-1' }, { id: 'todo-2' }],
    ];
    await setCommentResolved(ADMIN, PROJECT, COMMENT, true);
    const retire = db.state.queries.find((q) => /UPDATE tasks/i.test(q)) ?? '';
    expect(retire, 'the ToDos are retired').not.toBe('');
    expect(retire).toMatch(/status = 'completed'/i);
    expect(retire, 'narrowed to what this module projects').toMatch(/task_type IN \('project_task', 'project_comment'\)/i);
    expect(retire, 'and to this tenant').toMatch(/tenant_id = \?/);
  });

  it('REOPENING does not close anything, and clears the stamp', async () => {
    db.state.results = [[row()]];
    const r = await setCommentResolved(ADMIN, PROJECT, COMMENT, false);
    expect(r.ok).toBe(true);
    expect(db.state.queries.some((q) => /UPDATE tasks/i.test(q))).toBe(false);
    const i = db.state.queries.findIndex((q) => /UPDATE project_comments/i.test(q));
    expect(db.state.values[i]).toContain(null);
  });

  it('rides a compare-and-swap, so a double-click cannot stamp twice', async () => {
    db.state.results = [[], [{ id: COMMENT }]];
    const r = await setCommentResolved(ADMIN, PROJECT, COMMENT, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ALREADY_IN_STATE');
    expect(db.state.queries[0]).toMatch(/\(resolved_at IS NULL\) = \?/);
  });

  it('an EMPLOYEE may resolve — a thread only a manager can close is a notebook', async () => {
    db.state.results = [[row({ resolvedAt: 'x', resolvedBy: 'u-sam' })], []];
    const r = await setCommentResolved(SAM, PROJECT, COMMENT, true);
    expect(r.ok).toBe(true);
  });
});

// ── editing ──────────────────────────────────────────────────────────────────────────────────

describe('editing is the author, and only the author', () => {
  it('refuses somebody else, and points at the alternative', async () => {
    db.state.results = [[{ authorUserId: 'u-sam', mentions: [] }]];
    const r = await editComment(ADMIN, PROJECT, COMMENT, 'rewriting what they said');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toMatch(/Reply to it instead/);
    }
  });

  it('stamps edited_at, so an edit never claims to be the original', async () => {
    db.state.results = [[{ authorUserId: 'u-sam', mentions: [] }], [row({ editedAt: 'x' })]];
    await editComment(SAM, PROJECT, COMMENT, 'what I meant was Tuesday');
    const i = db.state.queries.findIndex((q) => /UPDATE project_comments/i.test(q));
    expect(db.state.queries[i]).toMatch(/edited_at = now\(\)/i);
  });

  it('notifies only the NEWLY mentioned — not everyone, on every typo fix', async () => {
    db.state.results = [
      [{ authorUserId: 'u-sam', mentions: ['u-dana'] }],
      [row({ mentions: ['u-dana'] })],
      [{ name: 'Phase II' }],
    ];
    await editComment(SAM, PROJECT, COMMENT, 'still @dana@acme.test, fixed a typo');
    expect(vi.mocked(createTask), 'Dana was already told').not.toHaveBeenCalled();
  });
});
