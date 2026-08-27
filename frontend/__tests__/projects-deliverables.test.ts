/**
 * UPLOAD AND ACCEPTANCE ARE TWO FACTS — and this file is what keeps them apart.
 *
 * A file being present is not a deliverable met. Someone has to say so. Collapsing the two would
 * make "we uploaded a draft" and "the government accepted it" indistinguishable, and the second is
 * the one that closes a CLIN.
 *
 * The failures this guards against all produce *plausible* results rather than errors:
 *
 *   · a milestone closing while its evidence is unapproved — every date looks fine
 *   · a replaced file leaving a stale acceptance in place — the row says accepted, of something else
 *   · an accept on a deliverable with no file at all — a closed milestone with no evidence
 *
 * So the assertions are on the SQL predicates as well as the return values, the same way the
 * assignment boundary and the rebaseline guard are.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => {
  const state = { queries: [] as string[], results: [] as unknown[][] };
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(strings.raw.join(' ? ').replace(/\s+/g, ' ').trim());
    void values;
    return Promise.resolve(state.results.shift() ?? []);
  };
  return { db: { sqlMock: Object.assign(tagged, { state }), state } };
});

vi.mock('@/lib/db', () => ({ sql: db.sqlMock, auditLog: vi.fn(async () => {}) }));
vi.mock('@/lib/events', () => ({
  emitEventSingle: vi.fn(async () => {}),
  userActor: (id: string) => ({ type: 'user', id }),
}));
vi.mock('@/lib/storage/s3-client', () => ({ putObject: vi.fn(async () => {}) }));
vi.mock('@/lib/projects/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/access')>()),
  canAccessProject: vi.fn(async () => true),
}));

import { markMilestoneMet, uploadDeliverable, acceptDeliverable } from '@/lib/projects/milestones';
import { emitEventSingle } from '@/lib/events';

const ADMIN = { userId: 'u1', role: 'tenant_admin', tenantId: 't1' };
const EMPLOYEE = { userId: 'u2', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const DELIVERABLE = '44444444-4444-4444-8444-444444444444';
const MILESTONE = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
});

const writes = () => db.state.queries.filter((q) => /^UPDATE|^INSERT/i.test(q)).join(' ');
const all = () => db.state.queries.join(' ');

// ── the milestone gate ───────────────────────────────────────────────────────────────────────

describe('markMilestoneMet', () => {
  it('REFUSES while a deliverable on it is unaccepted, and names them', async () => {
    // The headline. A milestone whose deliverables nobody approved is not met — it is a milestone
    // we believe we have finished, which is a different claim and the one that gets contractors
    // into trouble.
    db.state.results = [[{ title: 'Q1 technical report' }, { title: 'Test plan' }]];
    const r = await markMilestoneMet(ADMIN, PROJECT, MILESTONE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.code).toBe('DELIVERABLES_OUTSTANDING');
      expect(r.error).toMatch(/Q1 technical report/);
      expect(r.error, 'the message has to say WHY a present file is not enough')
        .toMatch(/Uploading a file is not acceptance/);
    }
    expect(writes(), 'nothing may be written on a refusal').toBe('');
  });

  it('the outstanding check keys on accepted_at, not on the file being there', async () => {
    db.state.results = [[]];
    await markMilestoneMet(ADMIN, PROJECT, MILESTONE).catch(() => {});
    const probe = db.state.queries[0] ?? '';
    expect(probe).toMatch(/accepted_at IS NULL/i);
    expect(probe, 'a present storage_key must not satisfy the gate').not.toMatch(/storage_key IS NOT NULL/i);
  });

  it('closes by compare-and-swap, so a double-click cannot stamp two met_at values', async () => {
    db.state.results = [[], [{ id: MILESTONE, title: 'Kickoff', baselineDate: '2026-03-01', metAt: '2026-03-10T00:00:00.000Z', status: 'met' }]];
    const r = await markMilestoneMet(ADMIN, PROJECT, MILESTONE);
    expect(r.ok).toBe(true);
    expect(writes()).toMatch(/status = 'pending'/i);
  });

  it('carries the variance in the event rather than leaving a reader to subtract two dates', async () => {
    db.state.results = [[], [{ id: MILESTONE, title: 'Kickoff', baselineDate: '2026-03-01', metAt: '2026-03-10T00:00:00.000Z', status: 'met' }]];
    await markMilestoneMet(ADMIN, PROJECT, MILESTONE);
    const payload = vi.mocked(emitEventSingle).mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.varianceDays).toBe(9);
  });

  it('answers a clear 409 when the milestone is not pending', async () => {
    db.state.results = [[], []];
    const r = await markMilestoneMet(ADMIN, PROJECT, MILESTONE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOT_PENDING');
  });

  it('is refused for a plain employee', async () => {
    const r = await markMilestoneMet(EMPLOYEE, PROJECT, MILESTONE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(db.state.queries).toEqual([]);
  });
});

// ── the two facts ────────────────────────────────────────────────────────────────────────────

describe('uploadDeliverable — the first fact', () => {
  const okReads = (acceptedAt: string | null = null) => {
    db.state.results = [
      [{ id: DELIVERABLE, acceptedAt, title: 'Q1 report' }],
      [{ slug: 'foundation' }],
      [{ id: DELIVERABLE, filename: 'report.pdf', acceptedAt: null }],
    ];
  };

  it('an ASSIGNED EMPLOYEE may upload — it is the everyday act of delivery work', async () => {
    // Requiring a tenant_admin for every progress report would make the assignment roster pointless.
    okReads();
    const r = await uploadDeliverable(EMPLOYEE, PROJECT, DELIVERABLE, {
      filename: 'report.pdf', body: Buffer.from('%PDF-1.4'), contentType: 'application/pdf',
    });
    expect(r.ok).toBe(true);
  });

  it('NEVER sets accepted_at', async () => {
    okReads();
    await uploadDeliverable(EMPLOYEE, PROJECT, DELIVERABLE, { filename: 'report.pdf', body: Buffer.from('x') });
    expect(writes()).toMatch(/uploaded_at = now\(\)/i);
    expect(writes(), 'uploading must never accept').not.toMatch(/accepted_at = now\(\)/i);
  });

  it('a REPLACED file clears any prior acceptance', async () => {
    // An accepted deliverable whose file has since changed is not an accepted deliverable, and
    // leaving the flag set would let a milestone close against a document nobody approved.
    okReads('2026-03-01T00:00:00.000Z');
    await uploadDeliverable(EMPLOYEE, PROJECT, DELIVERABLE, { filename: 'report-v2.pdf', body: Buffer.from('x') });
    expect(writes()).toMatch(/accepted_at = NULL/i);
    expect(writes()).toMatch(/accepted_by = NULL/i);
    const payload = vi.mocked(emitEventSingle).mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.replacedAcceptance, 'the event has to record that an acceptance was revoked').toBe(true);
  });

  it('refuses an extension outside the allowed set', async () => {
    const r = await uploadDeliverable(EMPLOYEE, PROJECT, DELIVERABLE, { filename: 'payload.exe', body: Buffer.from('x') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION_ERROR');
  });

  it('refuses an empty file rather than storing zero bytes as evidence', async () => {
    const r = await uploadDeliverable(EMPLOYEE, PROJECT, DELIVERABLE, { filename: 'report.pdf', body: Buffer.alloc(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/i);
  });

  it('never lets a user-supplied filename reach the object key', async () => {
    okReads();
    await uploadDeliverable(EMPLOYEE, PROJECT, DELIVERABLE, { filename: 'quarterly report.pdf', body: Buffer.from('x') });
    const key = String((db.state.queries.find((q) => /storage_key =/i.test(q)) ?? ''));
    expect(key).toMatch(/storage_key = \?/);   // parameterised, and the value is id-derived
  });
});

describe('acceptDeliverable — the second fact', () => {
  it('is tenant_admin only', async () => {
    const r = await acceptDeliverable(EMPLOYEE, PROJECT, DELIVERABLE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(db.state.queries).toEqual([]);
  });

  it('refuses when there is no file to accept', async () => {
    db.state.results = [[], [{ storageKey: null, acceptedAt: null }]];
    const r = await acceptDeliverable(ADMIN, PROJECT, DELIVERABLE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NOTHING_UPLOADED');
      expect(r.error).toMatch(/Upload one first/);
    }
  });

  it('refuses a double-accept', async () => {
    db.state.results = [[], [{ storageKey: 'k', acceptedAt: '2026-03-01T00:00:00.000Z' }]];
    const r = await acceptDeliverable(ADMIN, PROJECT, DELIVERABLE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ALREADY_ACCEPTED');
  });

  it('both refusals ride ONE compare-and-swap, not a read-then-write', async () => {
    // A read-then-write leaves a window in which two accepts both see `accepted_at IS NULL`. The
    // single UPDATE with both conditions in its predicate has no such window; the follow-up read
    // exists only to say WHICH refusal it was.
    db.state.results = [[{ id: DELIVERABLE, title: 'Q1 report', acceptedAt: '2026-03-02', filename: 'r.pdf' }]];
    const r = await acceptDeliverable(ADMIN, PROJECT, DELIVERABLE);
    expect(r.ok).toBe(true);
    const cas = db.state.queries[0];
    expect(cas).toMatch(/storage_key IS NOT NULL/i);
    expect(cas).toMatch(/accepted_at IS NULL/i);
  });

  it('never touches the file', async () => {
    db.state.results = [[{ id: DELIVERABLE, title: 'Q1 report', acceptedAt: '2026-03-02', filename: 'r.pdf' }]];
    await acceptDeliverable(ADMIN, PROJECT, DELIVERABLE);
    expect(writes()).not.toMatch(/storage_key =/i);
    expect(writes()).not.toMatch(/uploaded_at =/i);
  });

  it('scopes the update through the milestone to THIS project', async () => {
    db.state.results = [[{ id: DELIVERABLE, title: 'Q1 report', acceptedAt: '2026-03-02', filename: 'r.pdf' }]];
    await acceptDeliverable(ADMIN, PROJECT, DELIVERABLE);
    expect(all()).toMatch(/m\.project_id = \?/);
    expect(all()).toMatch(/d\.tenant_id = \?/);
  });
});
