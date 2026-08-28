/**
 * THE THIRD LEVEL — a project's own reminder policy.
 *
 * The rules worth holding, each of which would be invisible if wrong:
 *
 *  1. **Empty means INHERIT**, not "a copy taken at creation". The difference only shows up months
 *     later, when the tenant changes their default and half their projects ignore it.
 *  2. **The narrower scope can only NARROW.** A project may switch a reminder off that the tenant
 *     left on; it may not switch one on that the tenant switched off.
 *  3. **An unparseable override degrades to inherit**, never raises — the alternative is a project
 *     page that 500s on a value somebody typed into a form six months ago.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, gate } = vi.hoisted(() => {
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
    gate: { resolved: { enabled: true, assigneeRole: 'tenant_user', nudgeDays: [7, 2, 0], dueInMinutes: 0,
                        channel: 'both', cooldownMinutes: 0, maxFiresPerHour: 0,
                        source: { tenantPolicy: false, frameworkPinned: false } } },
  };
});

vi.mock('@/lib/db', () => ({ sql: db.sqlMock, auditLog: vi.fn(async () => {}) }));
vi.mock('@/lib/automation/policy', () => ({
  resolveGatePolicy: vi.fn(async () => gate.resolved),
}));

import { resolveProjectNotify, setProjectNotify, PROJECT_GATE_DEFAULTS } from '@/lib/projects/notify-policy';

const T = 't1';
const P = '22222222-2222-4222-8222-222222222222';
const TRIGGER = 'project:task.assigned' as const;

const withOverride = (v: unknown) => { db.state.results = [[{ notificationPolicy: { [TRIGGER]: v } }]]; };

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  gate.resolved = { enabled: true, assigneeRole: 'tenant_user', nudgeDays: [7, 2, 0], dueInMinutes: 0,
                    channel: 'both', cooldownMinutes: 0, maxFiresPerHour: 0,
                    source: { tenantPolicy: false, frameworkPinned: false } };
});

describe('empty means inherit', () => {
  it('an unconfigured project takes the resolved tenant answer', async () => {
    db.state.results = [[{ notificationPolicy: {} }]];
    gate.resolved.nudgeDays = [14, 3];
    gate.resolved.source.tenantPolicy = true;
    const r = await resolveProjectNotify(T, P, TRIGGER);
    expect(r.nudgeDays).toEqual([14, 3]);
    expect(r.source.projectOverride).toBe(false);
    expect(r.source.tenantPolicy).toBe(true);
  });

  it('and a project with NO row at all still answers — the dial is a refinement, not a prerequisite', async () => {
    db.state.results = [[]];
    const r = await resolveProjectNotify(T, P, TRIGGER);
    expect(r.nudgeDays).toEqual(PROJECT_GATE_DEFAULTS[TRIGGER].nudgeDays);
  });

  it('a failed read does not stop the reminder going out on the tenant’s settings', async () => {
    db.state.results = [Object.assign(new Error('down'), { code: '08006' }) as never];
    const r = await resolveProjectNotify(T, P, TRIGGER);
    expect(r.enabled).toBe(true);
    expect(r.source.projectOverride).toBe(false);
  });
});

describe('the narrower scope can only narrow', () => {
  it('a project may switch a reminder OFF that the tenant left on', async () => {
    withOverride({ enabled: false });
    const r = await resolveProjectNotify(T, P, TRIGGER);
    expect(r.enabled).toBe(false);
  });

  it('and may NOT switch one on that the tenant switched off', async () => {
    // Otherwise a customer who turned something off centrally would find it still firing from
    // forty projects, and would have to visit all forty to discover why.
    gate.resolved.enabled = false;
    withOverride({ enabled: true });
    const r = await resolveProjectNotify(T, P, TRIGGER);
    expect(r.enabled).toBe(false);
  });
});

describe('what a stored override is allowed to be', () => {
  it('takes a valid cadence, sorted DESCENDING — "days before due"', async () => {
    // An ascending list would nudge on the day first and a week later, which is a reminder about
    // something that has already happened.
    withOverride({ nudgeDays: [0, 5, 1] });
    const r = await resolveProjectNotify(T, P, TRIGGER);
    expect(r.nudgeDays).toEqual([5, 1, 0]);
    expect(r.source.projectOverride).toBe(true);
  });

  it('de-duplicates', async () => {
    withOverride({ nudgeDays: [3, 3, 1] });
    expect((await resolveProjectNotify(T, P, TRIGGER)).nudgeDays).toEqual([3, 1]);
  });

  it('IGNORES nonsense and falls back to inherit, rather than raising', async () => {
    for (const bad of [['soon'], [], [-1], [400], 'weekly', 42, null, [1, 2, 3, 4, 5, 6, 7, 8, 9]]) {
      db.state.results = [[{ notificationPolicy: { [TRIGGER]: { nudgeDays: bad } } }]];
      const r = await resolveProjectNotify(T, P, TRIGGER);
      expect(r.nudgeDays, `nudgeDays=${JSON.stringify(bad)}`).toEqual([7, 2, 0]);
      expect(r.source.projectOverride).toBe(false);
    }
  });

  it('ignores an unknown channel', async () => {
    withOverride({ channel: 'carrier pigeon' });
    const r = await resolveProjectNotify(T, P, TRIGGER);
    expect(r.channel).toBe('both');
  });

  it('takes a known one', async () => {
    withOverride({ channel: 'todo' });
    expect((await resolveProjectNotify(T, P, TRIGGER)).channel).toBe('todo');
  });
});

describe('writing it', () => {
  it('CLEARS by removing the key, so "inherit" reads as absent', async () => {
    // Storing `{}` would be a configured no-op a later reader could not tell from an override.
    db.state.results = [[]];
    await setProjectNotify(T, P, TRIGGER, { enabled: null, nudgeDays: null, channel: null });
    const q = db.state.queries.find((x) => /UPDATE projects/i.test(x)) ?? '';
    expect(q).toMatch(/notification_policy - \?/);
    expect(q).not.toMatch(/\|\|/);
  });

  it('MERGES rather than replacing — one trigger’s setting cannot wipe another’s', async () => {
    db.state.results = [[]];
    await setProjectNotify(T, P, TRIGGER, { nudgeDays: [5, 1] });
    const q = db.state.queries.find((x) => /UPDATE projects/i.test(x)) ?? '';
    expect(q).toMatch(/notification_policy \|\| \?/);
  });

  it('refuses to store a cadence it would then ignore on read', async () => {
    // The write and the read validate identically, so a value cannot be accepted by one and
    // discarded by the other — which is how a person comes to believe a setting took.
    db.state.results = [[]];
    await setProjectNotify(T, P, TRIGGER, { nudgeDays: [-4] });
    const q = db.state.queries.find((x) => /UPDATE projects/i.test(x)) ?? '';
    expect(q, 'nothing valid was given, so it clears').toMatch(/notification_policy - \?/);
  });

  it('is scoped by tenant as well as id', async () => {
    db.state.results = [[]];
    await setProjectNotify(T, P, TRIGGER, { channel: 'todo' });
    const q = db.state.queries.find((x) => /UPDATE projects/i.test(x)) ?? '';
    expect(q).toMatch(/tenant_id = \?/);
  });
});
