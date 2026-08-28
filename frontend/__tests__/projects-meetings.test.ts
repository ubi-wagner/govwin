/**
 * MEETINGS — and the one failure that leaves two records disagreeing.
 *
 * Somebody reads back five agreements at the end of a call. If raising them is five separate saves,
 * or if one is silently dropped, the notes claim five and the plan holds two — and both look
 * complete. Nothing errors; the disagreement surfaces weeks later when the thing nobody was
 * assigned does not happen.
 *
 * So the cases here are about the batch and its refusals, and about action items being ORDINARY
 * tasks rather than a fifth private checklist.
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
}));

import { recordMeeting, raiseActionItems } from '@/lib/projects/meetings';
import { emitEventSingle } from '@/lib/events';
import { createMilestoneTask } from '@/lib/projects/milestone-tasks';

const ADMIN = { userId: 'u-admin', role: 'tenant_admin', tenantId: 't1' };
const EMPLOYEE = { userId: 'u-emp', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const MEETING = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const meetingRow = { id: MEETING, title: 'CDR walkthrough' };

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
  vi.mocked(createMilestoneTask).mockReset();
  vi.mocked(createMilestoneTask).mockResolvedValue({ ok: true, data: { id: 'task-1' } } as never);
});

// ── recording ────────────────────────────────────────────────────────────────────────────────

describe('recording a meeting', () => {
  const good = { title: 'CDR walkthrough', heldOn: '2026-05-04', attendees: ['Kate U.', 'J. Rivera (COR)'] };

  it('creates the NOTES as a canvas document in the same write', async () => {
    // Not a `notes text` column. The same editor, compliance floor and exporters every other
    // project artifact uses — minutes that cannot be exported are minutes nobody can send.
    db.state.results = [[], [{ id: MEETING, title: good.title }]];
    const r = await recordMeeting(EMPLOYEE, PROJECT, good);
    expect(r.ok).toBe(true);
    expect(db.state.queries.some((q) => /INSERT INTO tenant_documents/i.test(q))).toBe(true);
  });

  it('seeds the minutes with facts read off the row, and invents no agenda', async () => {
    // Scaffolding "Attendees / Discussion / Actions" would put structure into a record of what was
    // actually said, and the product does not know what was said.
    db.state.results = [[], [{ id: MEETING, title: good.title }]];
    await recordMeeting(EMPLOYEE, PROJECT, good);
    const i = db.state.queries.findIndex((q) => /INSERT INTO tenant_documents/i.test(q));
    const canvas = db.state.values[i].find(
      (v): v is { nodes: unknown[] } => Boolean(v) && Array.isArray((v as { nodes?: unknown }).nodes),
    );
    const nodes = JSON.stringify(canvas!.nodes);
    expect(nodes).toContain('CDR walkthrough');
    expect(nodes).toContain('J. Rivera (COR)');
    for (const invented of ['Agenda', 'Discussion', 'Next steps']) {
      expect(nodes, `"${invented}" was never read from a row`).not.toContain(invented);
    }
  });

  it('an EMPLOYEE can record one — whoever took the notes', async () => {
    db.state.results = [[], [{ id: MEETING, title: good.title }]];
    const r = await recordMeeting(EMPLOYEE, PROJECT, good);
    expect(r.ok).toBe(true);
  });

  it('keeps attendees as NAMES, with no attempt to resolve them to users', async () => {
    // Half the room usually works for the customer. Resolving would either lose them or invent an
    // identity the product never verified — the same rule as acceptance evidence.
    db.state.results = [[], [{ id: MEETING, title: good.title }]];
    await recordMeeting(EMPLOYEE, PROJECT, good);
    expect(db.state.queries.some((q) => /FROM users/i.test(q))).toBe(false);
  });

  it('de-duplicates and trims the attendee list', async () => {
    db.state.results = [[], [{ id: MEETING, title: good.title }]];
    await recordMeeting(EMPLOYEE, PROJECT, { ...good, attendees: [' Kate U. ', 'Kate U.', '', 'J. Rivera'] });
    const i = db.state.queries.findIndex((q) => /INSERT INTO project_meetings/i.test(q));
    const list = db.state.values[i].find((v) => Array.isArray(v)) as string[];
    expect(list).toEqual(['Kate U.', 'J. Rivera']);
  });

  it('refuses a meeting with no date — a meeting that did not happen on a day did not happen', async () => {
    const r = await recordMeeting(EMPLOYEE, PROJECT, { title: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/heldOn/);
    expect(db.state.queries).toEqual([]);
  });
});

// ── the batch ────────────────────────────────────────────────────────────────────────────────

describe('raising what was agreed', () => {
  it('takes them ALL in one call — that is how a meeting ends', async () => {
    db.state.results = [[meetingRow], [], [], []];
    const r = await raiseActionItems(ADMIN, PROJECT, MEETING, [
      { title: 'Order long-lead parts' },
      { title: 'Re-run the thermal model' },
      { title: 'Send the revised SOW' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.taskIds).toHaveLength(3);
  });

  it('each becomes an ORDINARY project task, not a private checklist row', async () => {
    db.state.results = [[meetingRow], []];
    await raiseActionItems(ADMIN, PROJECT, MEETING, [{ title: 'Order long-lead parts' }]);
    const opts = vi.mocked(createMilestoneTask).mock.calls[0][2];
    expect(opts.milestoneId, 'standing work — not filed under a phase it does not gate').toBeNull();
    expect(opts.detail, 'and it says where it came from').toMatch(/CDR walkthrough/);
  });

  it('stamps meeting_id, so six weeks later "who agreed to this" has an answer', async () => {
    db.state.results = [[meetingRow], []];
    await raiseActionItems(ADMIN, PROJECT, MEETING, [{ title: 'Order long-lead parts' }]);
    const back = db.state.queries.find((q) => /UPDATE project_milestone_tasks SET meeting_id/i.test(q));
    expect(back).toBeTruthy();
  });

  it('ONE refused item does not lose the other two, and comes back named', async () => {
    // Silently dropping it leaves the notes claiming three agreements beside a plan holding two,
    // and both look complete.
    vi.mocked(createMilestoneTask)
      .mockResolvedValueOnce({ ok: true, data: { id: 'task-1' } } as never)
      .mockResolvedValueOnce({ ok: false, status: 409, code: 'NOT_ON_PROJECT', error: 'not on this project' } as never)
      .mockResolvedValueOnce({ ok: true, data: { id: 'task-3' } } as never);
    db.state.results = [[meetingRow], [], []];
    const r = await raiseActionItems(ADMIN, PROJECT, MEETING, [
      { title: 'A' }, { title: 'B', assigneeUserId: 'u-stranger' }, { title: 'C' },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.taskIds).toHaveLength(2);
      expect(r.data.refused).toHaveLength(1);
      expect(r.data.refused[0]).toMatch(/^B: /);
    }
  });

  it('but NOTHING landing is a refusal, not a partial success', async () => {
    // An employee raising action items hits createMilestoneTask's tenant_admin rule. Answering 201
    // with an empty list would tell them it worked.
    vi.mocked(createMilestoneTask).mockResolvedValue(
      { ok: false, status: 403, code: 'FORBIDDEN', error: 'Only a tenant admin can add tasks' } as never,
    );
    db.state.results = [[meetingRow]];
    const r = await raiseActionItems(EMPLOYEE, PROJECT, MEETING, [{ title: 'A' }, { title: 'B' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(403);
      expect(r.error).toMatch(/No action items could be raised/);
    }
  });

  it('reports both halves on the event, so a reader is not told five when it was four', async () => {
    vi.mocked(createMilestoneTask)
      .mockResolvedValueOnce({ ok: true, data: { id: 'task-1' } } as never)
      .mockResolvedValueOnce({ ok: false, status: 409, code: 'X', error: 'nope' } as never);
    db.state.results = [[meetingRow], []];
    await raiseActionItems(ADMIN, PROJECT, MEETING, [{ title: 'A' }, { title: 'B' }]);
    const ev = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'meeting.actions_raised');
    const payload = ev![0].payload as Record<string, unknown>;
    expect(payload.raised).toBe(1);
    expect(payload.refused).toBe(1);
  });

  it('refuses a meeting from another project', async () => {
    db.state.results = [[]];
    const r = await raiseActionItems(ADMIN, PROJECT, MEETING, [{ title: 'A' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it('skips blank titles rather than creating a task called nothing', async () => {
    db.state.results = [[meetingRow], []];
    const r = await raiseActionItems(ADMIN, PROJECT, MEETING, [{ title: '  ' }, { title: 'Real one' }]);
    expect(r.ok).toBe(true);
    expect(vi.mocked(createMilestoneTask)).toHaveBeenCalledTimes(1);
  });
});
