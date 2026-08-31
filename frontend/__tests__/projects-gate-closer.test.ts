/**
 * THE AI-MANAGER GATE CLOSER — and the asymmetry that makes it safe.
 *
 * The safety argument is structural, not careful: `attemptAutoClose` does not close a milestone, it
 * calls `markMilestoneMet` — the only thing that ever has, and the thing that already refuses on
 * open tasks and unaccepted deliverables.
 *
 * So: **a human can close a milestone the agent would not; the agent can never close one a human
 * could not.** These tests assert both halves, and the first one is asserted on the SOURCE, because
 * a second write path added later would still return a perfectly-shaped outcome.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { db, ms } = vi.hoisted(() => {
  const state = { queries: [] as string[], results: [] as unknown[][], values: [] as unknown[][] };
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(strings.raw.join(' ? ').replace(/\s+/g, ' ').trim());
    state.values.push(values);
    const next = state.results.shift() ?? [];
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };
  return {
    db: { sqlMock: Object.assign(tagged, { state, json: (v: unknown) => v }), state },
    ms: { result: { ok: true, data: { id: 'm1' } } as unknown },
  };
});

vi.mock('@/lib/db', () => ({ sql: db.sqlMock, auditLog: vi.fn(async () => {}) }));
vi.mock('@/lib/events', () => ({
  emitEventSingle: vi.fn(async () => {}),
  userActor: (id: string) => ({ type: 'user', id }),
}));
vi.mock('@/lib/projects/milestones', () => ({
  markMilestoneMet: vi.fn(async () => ms.result),
}));
vi.mock('@/lib/projects/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/access')>()),
  canAccessProject: vi.fn(async () => true),
}));

import { attemptAutoClose, setGateCloser } from '@/lib/projects/gate-closer';
import { markMilestoneMet } from '@/lib/projects/milestones';
import { emitEventSingle } from '@/lib/events';

const ADMIN = { userId: 'u-admin', role: 'tenant_admin', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const M = 'mmmmmmmm-mmmm-4mmm-8mmm-mmmmmmmmmmmm';

/** Milestone row, then risks, then unsent deliverables — the three reads, in order. */
const ready = (over: Record<string, unknown> = {}, risks: unknown[] = [], unsent: unknown[] = []) => {
  db.state.results = [
    [{ id: M, title: 'CDR', gateCloser: 'ai_manager', status: 'pending', ...over }],
    risks,
    unsent,
  ];
};

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.results = [];
  ms.result = { ok: true, data: { id: M } };
  vi.mocked(markMilestoneMet).mockClear();
  vi.mocked(emitEventSingle).mockClear();
});

// ── the asymmetry ────────────────────────────────────────────────────────────────────────────

describe('the agent can never close what a human could not', () => {
  it('goes through markMilestoneMet — the ONE writer', async () => {
    ready();
    const r = await attemptAutoClose(ADMIN, PROJECT, M);
    expect(r.closed).toBe(true);
    expect(markMilestoneMet).toHaveBeenCalledOnce();
  });

  it('and there is NO second write path — asserted on the source', () => {
    // A future "the agent knows it is fine, skip the check" would still return a well-shaped
    // outcome, so the shape cannot catch it. The absence of an UPDATE can.
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, '..', 'lib', 'projects', 'gate-closer.ts'), 'utf8');
    expect(src, 'the closer must never write a milestone status itself')
      .not.toMatch(/UPDATE\s+project_milestones\s+SET\s+status/i);
    expect(src).not.toMatch(/met_at\s*=/i);
  });

  it('reports markMilestoneMet’s refusal VERBATIM, not paraphrased', async () => {
    // The person sees the same sentence they would have seen clicking the button themselves.
    ready();
    ms.result = { ok: false, status: 409, code: 'TASKS_OUTSTANDING', error: '2 task(s) on this milestone are not done: X, Y.' };
    const r = await attemptAutoClose(ADMIN, PROJECT, M);
    expect(r.closed).toBe(false);
    expect(r.reason).toBe('2 task(s) on this milestone are not done: X, Y.');
    expect(r.objections, 'not an objection — the rows simply were not ready').toEqual([]);
  });
});

describe('it is opt-in, per milestone', () => {
  it('refuses a milestone whose closer is a person', async () => {
    ready({ gateCloser: 'human' });
    const r = await attemptAutoClose(ADMIN, PROJECT, M);
    expect(r.closed).toBe(false);
    expect(r.reason).toMatch(/closed by a person/);
    expect(markMilestoneMet).not.toHaveBeenCalled();
  });

  it('refuses one that is already met', async () => {
    ready({ status: 'met' });
    const r = await attemptAutoClose(ADMIN, PROJECT, M);
    expect(r.closed).toBe(false);
    expect(markMilestoneMet).not.toHaveBeenCalled();
  });

  it('refuses a milestone from another project', async () => {
    db.state.results = [[]];
    const r = await attemptAutoClose(ADMIN, PROJECT, M);
    expect(r.closed).toBe(false);
    expect(r.reason).toMatch(/not on this project/);
  });
});

// ── what the agent actually contributes ──────────────────────────────────────────────────────

describe('the agent’s judgement can only BLOCK, never permit', () => {
  it('declines when a high-scoring risk is open against the phase', async () => {
    // The boxes are ticked and something still wants a person's eyes. This is the contribution —
    // not permission, which the deterministic gates already grant.
    ready({}, [{ title: 'Actuator lead time', score: 20, kind: 'risk' }]);
    const r = await attemptAutoClose(ADMIN, PROJECT, M);
    expect(r.closed).toBe(false);
    expect(r.objections[0]).toMatch(/Actuator lead time/);
    expect(markMilestoneMet, 'and it never even attempts the close').not.toHaveBeenCalled();
  });

  it('declines when a deliverable is accepted internally but never SENT', async () => {
    // markMilestoneMet does not check this — acceptance is its gate — so it is exactly the sort of
    // thing worth stopping for: every box ticked and the customer has nothing.
    ready({}, [], [{ title: 'CDR package' }]);
    const r = await attemptAutoClose(ADMIN, PROJECT, M);
    expect(r.closed).toBe(false);
    expect(r.objections[0]).toMatch(/not been sent to the customer/);
  });

  it('emits a DECLINED event, so a silent non-close is visible', async () => {
    ready({}, [{ title: 'X', score: 16, kind: 'issue' }]);
    await attemptAutoClose(ADMIN, PROJECT, M);
    const ev = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'milestone.auto_close_declined');
    expect(ev, 'a sweep that declined silently is indistinguishable from one that did nothing').toBeTruthy();
    expect((ev![0].payload as Record<string, unknown>).objections).toHaveLength(1);
  });

  it('a LOW-scoring risk does not block — the bar is a real threshold', async () => {
    ready({}, []);   // the risk query is scoped `score >= 15` in SQL, so a low one returns nothing
    const r = await attemptAutoClose(ADMIN, PROJECT, M);
    expect(r.closed).toBe(true);
    const q = db.state.queries.find((x) => /project_risks/i.test(x)) ?? '';
    expect(q).toMatch(/score >= \?/);
  });

  it('scopes the risk lookup to THIS milestone, not the whole project', async () => {
    ready();
    await attemptAutoClose(ADMIN, PROJECT, M);
    const q = db.state.queries.find((x) => /project_risks/i.test(x)) ?? '';
    expect(q).toMatch(/milestone_id = \?/);
  });
});

describe('it never throws', () => {
  it('a database error is an outcome with a reason, not an exception', async () => {
    // It is called from a sweep. A raised exception would stop every milestone after this one.
    db.state.results = [Object.assign(new Error('down'), { code: '08006' }) as never];
    const r = await attemptAutoClose(ADMIN, PROJECT, M);
    expect(r.closed).toBe(false);
    expect(r.reason).toMatch(/Could not evaluate/);
  });
});

describe('setting the closer', () => {
  it('refuses a value outside the pair', async () => {
    const r = await setGateCloser(ADMIN, PROJECT, M, 'whenever' as never);
    expect(r.ok).toBe(false);
    expect(db.state.queries).toEqual([]);
  });

  it('scopes the write by project AND tenant', async () => {
    db.state.results = [[{ id: M }]];
    await setGateCloser(ADMIN, PROJECT, M, 'ai_manager');
    const q = db.state.queries.find((x) => /UPDATE project_milestones/i.test(x)) ?? '';
    expect(q).toMatch(/project_id = \?/);
    expect(q).toMatch(/tenant_id = \?/);
  });
});
