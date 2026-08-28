/**
 * The baseline: the only number in this capability that cannot be recomputed after the fact.
 *
 * Migration 216 enforces immutability in a TRIGGER, and `verify-project-isolation.mjs` proves that
 * against a live database. This file asserts the half the trigger cannot: that the application
 * refuses the same things LEGIBLY, before the database has to, and that the rebaseline statement
 * does not name the baseline columns at all.
 *
 * ── THE SQL TEXT ASSERTION, AGAIN ────────────────────────────────────────────────────────────
 * Asserting that `rebaseline` touches `planned_*` and not `baseline_*` is unusual and deliberate,
 * for the same reason as the assignment boundary: the failure produces a plausible result rather
 * than an error. A rebaseline that shifted the baseline too would return "shifted 14 days", every
 * date would look consistent, and the variance would read zero — the schedule silently having never
 * slipped. The trigger would catch it at run time; this catches it at build time, and says why.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => {
  const state = {
    queries: [] as string[],
    /** Queued results, shifted per query. */
    results: [] as unknown[][],
    throws: null as Error | null,
  };
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(strings.raw.join(' ? ').replace(/\s+/g, ' ').trim());
    void values;
    if (state.throws) return Promise.reject(state.throws);
    return Promise.resolve(state.results.shift() ?? []);
  };
  const sqlMock = Object.assign(tagged, {
    state,
    begin: async (fn: (tx: unknown) => Promise<unknown>) => fn(tagged),
  });
  return { db: { sqlMock, state } };
});

vi.mock('@/lib/db', () => ({ sql: db.sqlMock, auditLog: vi.fn(async () => {}) }));
/**
 * `withTenant` is mocked to hand the fake `tx` straight through.
 *
 * The real one runs `SELECT set_config('app.tenant_id', …)` as its first statement, which this
 * harness's queued-results model would consume as if it were the first business query — shifting
 * every result by one and failing a test about something else entirely. That is a coupling to
 * plumbing, not to behaviour.
 *
 * The plumbing has its own proof, twice over: `__tests__/projects-tenant-transactions.test.ts`
 * fails if this module ever reaches for `sql.begin` again, and
 * `scripts/drive-project-lifecycle.mts` sets a baseline through the real route against a live
 * database with RLS on — which is what caught the escape in the first place.
 */
vi.mock('@/lib/rls', () => ({
  withTenant: async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) => fn(db.sqlMock),
}));
vi.mock('@/lib/events', () => ({
  withEventBracket: async (
    _p: unknown,
    fn: () => Promise<{ value: unknown }>,
  ) => (await fn()).value,
  emitEventSingle: vi.fn(async () => {}),
  userActor: (id: string) => ({ type: 'user', id }),
}));
vi.mock('@/lib/projects/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/access')>()),
  canAccessProject: vi.fn(async () => true),
}));

import { setBaseline, rebaseline } from '@/lib/projects/baseline';

const ADMIN = { userId: 'u1', role: 'tenant_admin', tenantId: 't1' };
const EMPLOYEE = { userId: 'u2', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';

/** Queue the reads `setBaseline` performs before it writes. */
function queueProject(baselinedAt: string | null, docs: Array<{ kind: string }>) {
  db.state.results = [
    [{ id: PROJECT, name: 'Ohio TVSF', baselinedAt }],   // the project row
    docs.map((d, i) => ({ id: `d${i}`, ...d })),          // listSourceDocuments (via readiness)
    // ONE write now, not two. The milestone IS the WBS element (mig 228), so freezing the plan is
    // freezing the milestones — and a baseline written against two tables is one that can
    // half-freeze.
    [{ id: 'm1' }],                                       // milestones UPDATE … RETURNING
    [{ baselinedAt: '2026-03-03T00:00:00.000Z' }],        // the project CAS
  ];
}

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.results = [];
  db.state.throws = null;
});

const bothDocs = [{ kind: 'executed_contract' }, { kind: 'submitted_proposal' }];
const allQueries = () => db.state.queries.join(' ');

describe('setBaseline', () => {
  it('freezes the plan when both anchor documents are present', async () => {
    queueProject(null, bothDocs);
    const r = await setBaseline(ADMIN, PROJECT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.baselinedAt).toBe('2026-03-03T00:00:00.000Z');
  });

  it('REFUSES a project that is already baselined — legibly, before the trigger has to', async () => {
    // The red-first case for this whole module. Without the guard the trigger raises 23001, which
    // reaches a user as a 500 and a stack trace.
    queueProject('2026-03-03T00:00:00.000Z', bothDocs);
    const r = await setBaseline(ADMIN, PROJECT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.code).toBe('ALREADY_BASELINED');
      expect(r.error, 'the message has to say what to do instead').toMatch(/rebaseline/i);
    }
    expect(allQueries(), 'nothing may be written on a refusal').not.toMatch(/UPDATE project_milestones/i);
  });

  it('REFUSES when an anchor document is missing, and names which one', async () => {
    queueProject(null, [{ kind: 'executed_contract' }]);
    const r = await setBaseline(ADMIN, PROJECT);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NOT_READY');
      expect(r.error).toMatch(/as-submitted proposal/);
    }
    expect(allQueries()).not.toMatch(/UPDATE project_milestones/i);
  });

  it('only sets baseline columns that are still NULL', async () => {
    // The trigger permits NULL → value and refuses value → different. The predicate keeps the
    // statement inside what the trigger allows rather than relying on the trigger to stop it.
    queueProject(null, bothDocs);
    await setBaseline(ADMIN, PROJECT);
    // One PREDICATE, guarding both frozen columns: `baseline_date IS NULL` is what makes the
    // statement a NULL -> value transition on a row that has never been baselined.
    expect(allQueries()).toMatch(/baseline_date IS NULL/i);
  });

  it('freezes BOTH promises — the date and the cost', async () => {
    // Migration 228 collapsed the WBS node into the milestone and, in doing so, dropped the only
    // frozen COST in the schema: the node had `baseline_cost`, the milestone had only
    // `baseline_date`. Every assertion in this file still passed. Schedule variance stayed
    // measurable and cost variance became structurally zero — `planned_cost` standing on both
    // sides of the subtraction — which renders as a project perfectly on budget. Migration 229
    // put the column back; this is the assertion that would have caught its absence.
    queueProject(null, bothDocs);
    await setBaseline(ADMIN, PROJECT);
    const froze = db.state.queries.find((q) => /UPDATE project_milestones/i.test(q)) ?? '';
    expect(froze).toMatch(/baseline_date\s*=\s*forecast_date/i);
    expect(froze).toMatch(/baseline_cost\s*=\s*planned_cost/i);
  });

  it('claims the project by compare-and-swap, so two requests cannot both win', async () => {
    queueProject(null, bothDocs);
    await setBaseline(ADMIN, PROJECT);
    expect(allQueries()).toMatch(/UPDATE projects .* baselined_at IS NULL/i);
  });

  it('is refused for a plain employee', async () => {
    const r = await setBaseline(EMPLOYEE, PROJECT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(db.state.queries, 'a role refusal must not reach the database').toEqual([]);
  });
});

describe('rebaseline', () => {
  const baselined = () => { db.state.results = [[{ id: PROJECT, baselinedAt: '2026-03-03' }], [{ id: 'm1' }]]; };

  it('shifts the CURRENT plan and does not name the baseline columns AT ALL', async () => {
    // The assertion this file exists for. A rebaseline that shifted the baseline too would return
    // "shifted 14 days", every date would look consistent, and the variance would read zero — the
    // schedule silently having never slipped.
    baselined();
    const r = await rebaseline(ADMIN, PROJECT, { shiftDays: 14, reason: 'Award delayed by CO' });
    expect(r.ok).toBe(true);

    const writes = db.state.queries.filter((q) => /^UPDATE/i.test(q)).join(' ');
    // BOTH ends of the window move. Shifting the end without the start silently compresses every
    // phase, and the dates still look like dates.
    expect(writes).toMatch(/starts_on = starts_on/i);
    expect(writes).toMatch(/forecast_date = forecast_date/i);
    expect(writes, 'the baseline is not part of this operation').not.toMatch(/baseline_start/i);
    expect(writes).not.toMatch(/baseline_end/i);
    expect(writes).not.toMatch(/baseline_cost/i);
    expect(writes).not.toMatch(/baseline_date/i);
  });

  it('requires a reason — it is the only record of why the schedule moved', async () => {
    const r = await rebaseline(ADMIN, PROJECT, { shiftDays: 14, reason: '  ' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION_ERROR');
    expect(db.state.queries).toEqual([]);
  });

  it('refuses a project with no baseline — there is nothing to rebaseline FROM', async () => {
    db.state.results = [[{ id: PROJECT, baselinedAt: null }]];
    const r = await rebaseline(ADMIN, PROJECT, { shiftDays: 7, reason: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NOT_BASELINED');
      expect(r.error).toMatch(/baseline it first/i);
    }
  });

  it('refuses a shift that moves nothing', async () => {
    baselined();
    const r = await rebaseline(ADMIN, PROJECT, { shiftDays: 0, reason: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION_ERROR');
  });

  it('refuses an absurd shift rather than moving a plan a decade', async () => {
    baselined();
    const r = await rebaseline(ADMIN, PROJECT, { shiftDays: 40000, reason: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION_ERROR');
  });

  it('leaves a MET milestone where it is', async () => {
    // A milestone that already happened does not move because the remaining plan slipped. Its date
    // is a fact, not a forecast.
    baselined();
    await rebaseline(ADMIN, PROJECT, { shiftDays: 14, reason: 'x' });
    const writes = db.state.queries.filter((q) => /project_milestones/i.test(q)).join(' ');
    expect(writes).toMatch(/status = 'pending'/i);
  });

  it('converts startOn into the same uniform shift, so durations survive', async () => {
    db.state.results = [
      [{ id: PROJECT, baselinedAt: '2026-03-03' }],
      [{ earliest: '2026-01-01' }],
      [{ id: 'w1' }],
      [{ id: 'm1' }],
    ];
    const r = await rebaseline(ADMIN, PROJECT, { startOn: '2026-01-15', reason: 'Kickoff moved' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.shiftedDays).toBe(14);
  });
});
