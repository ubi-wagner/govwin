/**
 * THE CDRL REGISTER — the obligation, the three states, and the marking.
 *
 * What is worth testing here:
 *
 *  1. **Sending is gated on internal acceptance.** Uploading is not accepting, and accepting is not
 *     sending — the third link in a chain this capability has now drawn ten times.
 *  2. **Lateness is measured against the day it was SENT**, not the day somebody finished writing,
 *     and the date arrives as a JavaScript `Date` — the #2 crash class in this codebase.
 *  3. **A missing distribution statement renders NOTHING.** Defaulting to "A" because it is the
 *     permissive one would stamp a public-release marking on something that may not be releasable.
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

import { addCdrlItem, markSubmitted, distributionMarking } from '@/lib/projects/cdrl';
import { emitEventSingle } from '@/lib/events';

const ADMIN = { userId: 'u-admin', role: 'tenant_admin', tenantId: 't1' };
const EMPLOYEE = { userId: 'u-emp', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const DEL = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const writes = () => db.state.queries.filter((q) => /^(INSERT|UPDATE|DELETE)/i.test(q)).join(' ');

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
});

// ── registering ──────────────────────────────────────────────────────────────────────────────

describe('registering a data requirement', () => {
  it('is refused for an employee', async () => {
    const r = await addCdrlItem(EMPLOYEE, PROJECT, { cdrlNumber: 'A001', title: 'Monthly report' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(db.state.queries).toEqual([]);
  });

  it('REFUSES a recurring item with no first due date, and says why', async () => {
    // Without one it has no schedule at all, and every "what is due" query would skip it silently.
    const r = await addCdrlItem(ADMIN, PROJECT, {
      cdrlNumber: 'A002', title: 'Monthly status report', frequency: 'monthly',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/first due date/);
      expect(r.error).toMatch(/what is due/);
    }
    expect(writes()).toBe('');
  });

  it('allows a ONE-TIME item with no date — there is no next', async () => {
    db.state.results = [[{ id: 'c1', cdrlNumber: 'A001' }]];
    const r = await addCdrlItem(ADMIN, PROJECT, {
      cdrlNumber: 'A001', title: 'Final report', frequency: 'one_time',
    });
    expect(r.ok).toBe(true);
  });

  it('refuses a distribution letter outside A–F', async () => {
    const r = await addCdrlItem(ADMIN, PROJECT, {
      cdrlNumber: 'A001', title: 'x', distribution: 'Z',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/A–F/);
  });

  it("refuses an approval code that is not 'A' or 'I', and explains both", async () => {
    const r = await addCdrlItem(ADMIN, PROJECT, { cdrlNumber: 'A001', title: 'x', approvalCode: 'X' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/approval required/i);
      expect(r.error).toMatch(/information only/i);
    }
  });

  it('REFUSES a CLIN from another project', async () => {
    db.state.results = [[]];
    const r = await addCdrlItem(ADMIN, PROJECT, {
      cdrlNumber: 'A001', title: 'x', clinId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not belong to this project/);
    expect(writes()).toBe('');
  });

  it('a duplicate CDRL number is a 409 that explains itself', async () => {
    db.state.results = [Object.assign(new Error('dup'), { code: '23505' }) as never];
    const r = await addCdrlItem(ADMIN, PROJECT, { cdrlNumber: 'A001', title: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DUPLICATE_CDRL_NUMBER');
  });
});

// ── the third state ──────────────────────────────────────────────────────────────────────────

describe('sending it to the customer', () => {
  const ready = (over: Record<string, unknown> = {}) => {
    db.state.results = [
      [{ id: DEL, title: 'Monthly report — April', acceptedAt: '2026-05-02',
         submittedAt: null, requiredBy: '2026-05-05', cdrlNumber: 'A002', ...over }],
      [{ id: DEL }],
    ];
  };

  it('REFUSES what has not been accepted internally', async () => {
    // Uploading is not accepting, and accepting is not sending. Ten times now.
    ready({ acceptedAt: null });
    const r = await markSubmitted(ADMIN, PROJECT, DEL, { submittedAt: '2026-05-04' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NOT_ACCEPTED');
      expect(r.error).toMatch(/Uploading is not accepting/);
    }
    expect(writes()).toBe('');
  });

  it('refuses to send the same thing twice', async () => {
    ready({ submittedAt: '2026-05-04' });
    const r = await markSubmitted(ADMIN, PROJECT, DEL, { submittedAt: '2026-05-06' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('ALREADY_SUBMITTED');
      expect(r.error, 'and says what to do instead').toMatch(/corrected version/);
    }
  });

  it('requires a delivery date — lateness is measured against the day it was SENT', async () => {
    const r = await markSubmitted(ADMIN, PROJECT, DEL, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/YYYY-MM-DD|delivery date/);
    expect(db.state.queries).toEqual([]);
  });

  it('reaches the deliverable THROUGH its milestone, which is what carries the project', async () => {
    // `project_deliverables` has no project_id of its own (mig 216, deliberately), so an id-only
    // lookup would answer for a row belonging to another project of the same tenant.
    ready();
    await markSubmitted(ADMIN, PROJECT, DEL, { submittedAt: '2026-05-04' });
    const read = db.state.queries.find((q) => /FROM project_deliverables d/i.test(q)) ?? '';
    expect(read).toMatch(/JOIN project_milestones m ON m\.id = d\.milestone_id/i);
    expect(read).toMatch(/m\.project_id = \?/);
    expect(read).toMatch(/d\.tenant_id = \?/);
  });

  it('claims it by compare-and-swap, so two people cannot both stamp the delivery', async () => {
    ready();
    await markSubmitted(ADMIN, PROJECT, DEL, { submittedAt: '2026-05-04' });
    const upd = db.state.queries.find((q) => /UPDATE project_deliverables/i.test(q)) ?? '';
    expect(upd).toMatch(/submitted_at IS NULL/i);
  });

  it('reports EARLY as a negative number, not as nothing', async () => {
    ready();   // required 2026-05-05, sent 2026-05-04
    const r = await markSubmitted(ADMIN, PROJECT, DEL, { submittedAt: '2026-05-04' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.daysLate).toBe(-1);
  });

  it('reports LATE, and carries it on the event', async () => {
    ready();
    const r = await markSubmitted(ADMIN, PROJECT, DEL, { submittedAt: '2026-05-12' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.daysLate).toBe(7);
    const ev = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'cdrl.submitted');
    expect((ev![0].payload as Record<string, unknown>).daysLate).toBe(7);
  });

  it('handles a `date` column arriving as a JavaScript Date', async () => {
    // The #2 crash class. `String(d).slice(0,10)` is "Tue May 05", which Date.parse turns into
    // NaN — and NaN survives every comparison to render as a confident number. A fixture of ISO
    // strings passes against the broken code, so this one is a real Date.
    ready({ requiredBy: new Date('2026-05-05T00:00:00Z') });
    const r = await markSubmitted(ADMIN, PROJECT, DEL, { submittedAt: '2026-05-12' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.daysLate).toBe(7);
  });

  it('is null when there was no required-by date — never a confident 0', async () => {
    ready({ requiredBy: null });
    const r = await markSubmitted(ADMIN, PROJECT, DEL, { submittedAt: '2026-05-12' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.daysLate).toBeNull();
  });

  it('maps the database gate (23001) onto the same legible refusal', async () => {
    db.state.results = [
      [{ id: DEL, title: 'x', acceptedAt: '2026-05-02', submittedAt: null, requiredBy: null, cdrlNumber: 'A002' }],
      Object.assign(new Error('A deliverable is accepted internally before it is sent'), { code: '23001' }) as never,
    ];
    const r = await markSubmitted(ADMIN, PROJECT, DEL, { submittedAt: '2026-05-04' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_ACCEPTED');
  });
});

// ── the marking ──────────────────────────────────────────────────────────────────────────────

describe('the distribution marking', () => {
  it('renders NOTHING when the contract declared none', () => {
    // The one that matters. Defaulting to "A" because it is the permissive letter would put a
    // public-release marking on a document that may not be publicly releasable — a legally
    // significant claim, invented by a UI convenience.
    expect(distributionMarking({ distribution: null, distributionNote: null })).toBeNull();
    expect(distributionMarking({ distribution: null, distributionNote: 'Export controlled' })).toBeNull();
  });

  it('renders the letter WITH its meaning — "B" alone tells a reader nothing', () => {
    const m = distributionMarking({ distribution: 'B', distributionNote: null });
    expect(m).toMatch(/DISTRIBUTION STATEMENT B/);
    expect(m).toMatch(/U\.S\. Government agencies only/);
  });

  it('appends the contract’s own wording verbatim', () => {
    const m = distributionMarking({
      distribution: 'C',
      distributionNote: 'Critical technology; 4 May 2026. Controlling office: AFRL/RQ.',
    });
    expect(m).toMatch(/Critical technology; 4 May 2026\. Controlling office: AFRL\/RQ\./);
  });
});
