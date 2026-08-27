/**
 * THE REVIEW GATE — and the one thing it must never become.
 *
 * The failure this feature could quietly introduce is the opposite of the one it fixes: a review
 * that ACCEPTS. Every other rule in this module keeps "somebody produced it" apart from "somebody
 * signed for it" — uploading is not accepting, authoring is not accepting — and an approval that
 * closed a CLIN would collapse the distinction from a third direction.
 *
 * So the cases here are: approving is not accepting · the gate blocks what it should and NOTHING
 * else · a rejection cannot be silent · one pending review · and a decision anyone could make is
 * not a gate.
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
vi.mock('@/lib/projects/todos', () => ({
  retireTodosByEntity: vi.fn(async () => 1),
}));
vi.mock('@/lib/projects/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/access')>()),
  canAccessProject: vi.fn(async () => true),
  listAssignees: vi.fn(async () => [
    { userId: 'u-dana', email: 'dana@acme.test', name: 'Dana', assignedAt: '' },
    { userId: 'u-sam', email: 'sam@acme.test', name: 'Sam', assignedAt: '' },
  ]),
}));

import { requestReview, decideReview, blockingReview } from '@/lib/projects/reviews';
import { emitEventSingle } from '@/lib/events';
import { createTask } from '@/lib/tasks/tasks';
import { retireTodosByEntity } from '@/lib/projects/todos';

const ADMIN = { userId: 'u-dana', role: 'tenant_admin', tenantId: 't1' };
const SAM = { userId: 'u-sam', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const DELIVERABLE = '44444444-4444-4444-8444-444444444444';
const REVIEW = '88888888-8888-4888-8888-888888888888';

const review = (o: Record<string, unknown> = {}) => ({
  id: REVIEW, projectId: PROJECT, entityType: 'deliverable', entityId: DELIVERABLE,
  requestedBy: 'u-sam', reviewerUserId: 'u-dana', reviewerRole: null, note: null, dueOn: null,
  status: 'pending', decidedBy: null, decidedAt: null, reason: null,
  createdAt: '2026-05-01T00:00:00.000Z', ...o,
});

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
  vi.mocked(createTask).mockClear();
  vi.mocked(retireTodosByEntity).mockClear();
});

// ── the gate ─────────────────────────────────────────────────────────────────────────────────

describe('blockingReview — only the LATEST review counts', () => {
  it('nothing ever reviewed blocks nothing, so what worked before still works', async () => {
    db.state.results = [[]];
    expect(await blockingReview('t1', 'deliverable', DELIVERABLE)).toBeNull();
  });

  it('an OPEN review blocks', async () => {
    db.state.results = [[{ status: 'pending', reason: null }]];
    expect(await blockingReview('t1', 'deliverable', DELIVERABLE)).toEqual({ status: 'pending', reason: null });
  });

  it('a REJECTED review blocks, and carries the reason forward', async () => {
    db.state.results = [[{ status: 'rejected', reason: 'wrong CLIN' }]];
    const b = await blockingReview('t1', 'deliverable', DELIVERABLE);
    expect(b?.status).toBe('rejected');
    expect(b?.reason, 'so the refusal can say WHY, not just no').toBe('wrong CLIN');
  });

  it('an APPROVED review does not block — that is the point of approving', async () => {
    db.state.results = [[{ status: 'approved', reason: null }]];
    expect(await blockingReview('t1', 'deliverable', DELIVERABLE)).toBeNull();
  });

  it('a WITHDRAWN review does not block — the request was taken back', async () => {
    db.state.results = [[{ status: 'withdrawn', reason: null }]];
    expect(await blockingReview('t1', 'deliverable', DELIVERABLE)).toBeNull();
  });

  it('reads the LATEST first, so a fresh request supersedes an old rejection', async () => {
    db.state.results = [[{ status: 'approved', reason: null }]];
    await blockingReview('t1', 'deliverable', DELIVERABLE);
    expect(db.state.queries[0]).toMatch(/ORDER BY created_at DESC LIMIT 1/i);
  });

  it('a database failure blocks rather than opening — a gate must not fail open', async () => {
    // Reporting "no blocker" on an error would turn a blip into an acceptance nobody reviewed.
    db.state.results = [new Error('connection lost') as unknown as unknown[]];
    const b = await blockingReview('t1', 'deliverable', DELIVERABLE);
    expect(b).not.toBeNull();
    expect(b?.status).toBe('unknown');
  });
});

// ── requesting ───────────────────────────────────────────────────────────────────────────────

describe('requesting a review', () => {
  it('is open to an EMPLOYEE — asking a colleague to look is collaboration', async () => {
    db.state.results = [[{ id: DELIVERABLE }], [review()], [{ name: 'Phase II' }]];
    const r = await requestReview(SAM, PROJECT, {
      entityType: 'deliverable', entityId: DELIVERABLE, reviewerUserId: 'u-dana',
    });
    expect(r.ok).toBe(true);
  });

  it('refuses a review addressed to nobody', async () => {
    const r = await requestReview(SAM, PROJECT, { entityType: 'deliverable', entityId: DELIVERABLE });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Say who should review it/);
    expect(db.state.queries, 'refused before touching the database').toEqual([]);
  });

  it("refuses an anchor from another project — no FK exists to stop it", async () => {
    db.state.results = [[]];
    const r = await requestReview(SAM, PROJECT, {
      entityType: 'deliverable', entityId: DELIVERABLE, reviewerUserId: 'u-dana',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not belong to this project/);
  });

  it('refuses a reviewer who is not on the project', async () => {
    db.state.results = [[{ id: DELIVERABLE }]];
    const r = await requestReview(SAM, PROJECT, {
      entityType: 'deliverable', entityId: DELIVERABLE, reviewerUserId: 'u-stranger',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_ON_PROJECT');
  });

  it('turns the unique-index violation into its own sentence, not a 500', async () => {
    // Three open reviews on one thing is three people believing they decide, so the gate's own
    // rule gets the gate's own message.
    const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
    db.state.results = [[{ id: DELIVERABLE }], dup as unknown as unknown[]];
    const r = await requestReview(SAM, PROJECT, {
      entityType: 'deliverable', entityId: DELIVERABLE, reviewerUserId: 'u-dana',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.code).toBe('REVIEW_ALREADY_OPEN');
    }
  });

  it('raises a ToDo and asks for email through the ONE seam', async () => {
    db.state.results = [[{ id: DELIVERABLE }], [review({ dueOn: '2026-06-01' })], [{ name: 'Phase II' }]];
    await requestReview(SAM, PROJECT, {
      entityType: 'deliverable', entityId: DELIVERABLE, reviewerUserId: 'u-dana', dueOn: '2026-06-01',
    });
    expect(vi.mocked(createTask)).toHaveBeenCalledTimes(1);
    const mail = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'notification.requested');
    expect((mail?.[0].payload as Record<string, unknown>)?.template).toBe('project_review_requested');
  });

  it('a DATED review gets nudges, unlike a mention — somebody is waiting on the answer', async () => {
    db.state.results = [[{ id: DELIVERABLE }], [review({ dueOn: '2026-06-01' })], [{ name: 'Phase II' }]];
    await requestReview(SAM, PROJECT, {
      entityType: 'deliverable', entityId: DELIVERABLE, reviewerUserId: 'u-dana', dueOn: '2026-06-01',
    });
    const opts = vi.mocked(createTask).mock.calls[0][0];
    expect(opts.dueAt).toMatch(/^2026-06-01T/);
    expect(opts.nudgeDays).toEqual([3, 1, 0]);
  });

  it('an UNDATED review is not nudged — there is no date to chase against', async () => {
    db.state.results = [[{ id: DELIVERABLE }], [review()], [{ name: 'Phase II' }]];
    await requestReview(SAM, PROJECT, {
      entityType: 'deliverable', entityId: DELIVERABLE, reviewerUserId: 'u-dana',
    });
    const opts = vi.mocked(createTask).mock.calls[0][0];
    expect(opts.dueAt).toBeNull();
    expect(opts.nudgeDays).toBeUndefined();
  });
});

// ── deciding ─────────────────────────────────────────────────────────────────────────────────

describe('deciding a review', () => {
  it('REFUSES a rejection with no reason — the whole point of the table', async () => {
    const r = await decideReview(ADMIN, PROJECT, REVIEW, 'rejected', '   ');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('VALIDATION_ERROR');
      expect(r.error).toMatch(/Say what is wrong with it/);
    }
    expect(db.state.queries, 'refused before reading anything').toEqual([]);
  });

  it('records a rejection WITH its reason, and tells whoever asked', async () => {
    db.state.results = [
      [review()],
      [review({ status: 'rejected', reason: 'Section 3 cites the wrong CLIN.', decidedAt: 'x' })],
      [{ name: 'Phase II' }],
    ];
    const r = await decideReview(ADMIN, PROJECT, REVIEW, 'rejected', 'Section 3 cites the wrong CLIN.');
    expect(r.ok).toBe(true);
    const mail = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'notification.requested');
    expect((mail?.[0].payload as Record<string, unknown>)?.template).toBe('project_review_decided');
    expect((mail?.[0].payload as Record<string, unknown>)?.reason).toMatch(/wrong CLIN/);
  });

  it('a NON-REVIEWER cannot decide — a gate anyone can open is not a gate', async () => {
    db.state.results = [[review({ reviewerUserId: 'u-dana' })]];
    const r = await decideReview(SAM, PROJECT, REVIEW, 'approved');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toMatch(/Only the reviewer/);
    }
  });

  it('the REQUESTER may withdraw, so a request made in error holds nothing hostage', async () => {
    db.state.results = [[review({ requestedBy: 'u-sam' })], [review({ status: 'withdrawn', decidedAt: 'x' })]];
    const r = await decideReview(SAM, PROJECT, REVIEW, 'withdrawn');
    expect(r.ok).toBe(true);
  });

  it('but a bystander may NOT withdraw somebody else’s request', async () => {
    db.state.results = [[review({ requestedBy: 'u-other', reviewerUserId: 'u-other' })]];
    const r = await decideReview(SAM, PROJECT, REVIEW, 'withdrawn');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
  });

  it('rides a compare-and-swap on `pending`, so two clicks cannot decide twice', async () => {
    db.state.results = [[review()], []];
    const r = await decideReview(ADMIN, PROJECT, REVIEW, 'approved');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ALREADY_DECIDED');
    const cas = db.state.queries.find((q) => /UPDATE project_reviews/i.test(q)) ?? '';
    expect(cas).toMatch(/status = 'pending'/i);
  });

  it('retires the reviewer’s ToDo — the question was answered', async () => {
    db.state.results = [[review()], [review({ status: 'approved', decidedAt: 'x' })], [{ name: 'P' }]];
    await decideReview(ADMIN, PROJECT, REVIEW, 'approved');
    expect(vi.mocked(retireTodosByEntity)).toHaveBeenCalledWith(
      expect.anything(), 'project_review', REVIEW, expect.anything(),
    );
  });

  it('NEVER touches the deliverable — approving is not accepting', async () => {
    // The failure this feature could introduce from a third direction. `accepted_at` is a
    // tenant_admin's separate act; a review that wrote it would collapse the distinction the
    // whole module is built on.
    db.state.results = [[review()], [review({ status: 'approved', decidedAt: 'x' })], [{ name: 'P' }]];
    await decideReview(ADMIN, PROJECT, REVIEW, 'approved');
    const all = db.state.queries.join(' ');
    expect(all).not.toMatch(/project_deliverables/i);
    expect(all).not.toMatch(/accepted_at/i);
  });
});
