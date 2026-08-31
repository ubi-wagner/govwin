/**
 * EVIDENCING IS NOT ACCEPTING — and a claim about somebody is not their act.
 *
 * This is the ingest-provenance rule applied to acceptance: *a value the product did not read from
 * the source must never look like one it did.* An admin types a contracting officer's name into a
 * form; the product has never met that person, verified nothing, and holds no record of them. The
 * row it writes must therefore be readable as "our admin reports that J. Rivera signed", never as
 * "J. Rivera signed".
 *
 * The failure this guards is the quiet one: nothing errors if the two are merged. A single
 * `acceptedBy` carrying a typed-in name would render a clean, confident, wrong sentence in a
 * dispute six months later — which is precisely when it matters.
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
vi.mock('@/lib/storage/s3-client', () => ({ putObject: vi.fn(async () => {}) }));
vi.mock('@/lib/projects/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/access')>()),
  canAccessProject: vi.fn(async () => true),
}));

import { fileAcceptanceEvidence } from '@/lib/projects/evidence';
import { emitEventSingle } from '@/lib/events';

const ADMIN = { userId: 'u-admin', role: 'tenant_admin', tenantId: 't1' };
const EMPLOYEE = { userId: 'u-emp', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const DELIVERABLE = '44444444-4444-4444-8444-444444444444';

const ok = () => {
  db.state.results = [
    [{ id: DELIVERABLE, title: 'Q1 technical report' }],   // the scoped deliverable lookup
    [{ slug: 'foundation' }],                              // the tenant slug for the object key
    [{ id: 'ev-1', deliverableId: DELIVERABLE, kind: 'cor_email', customerName: 'J. Rivera',
       customerRole: 'COR', occurredOn: '2026-04-02', filename: 'cor.eml',
       storageKey: 'k', note: null, uploadedBy: 'u-admin', uploadedAt: 'x' }],
  ];
};

const good = {
  kind: 'cor_email', customerName: 'J. Rivera', customerRole: 'COR',
  occurredOn: '2026-04-02', filename: 'cor.eml', body: Buffer.from('From: rivera'),
};

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
});

const writes = () => db.state.queries.filter((q) => /^UPDATE|^INSERT/i.test(q)).join(' ');

describe('filing evidence never accepts', () => {
  it('writes NOTHING to the deliverable — not accepted_at, not accepted_by', async () => {
    // The headline. Four ways to attach a fact — upload, author, approve, evidence — and one
    // deliberate act by a person allowed to make it.
    ok();
    const r = await fileAcceptanceEvidence(ADMIN, PROJECT, DELIVERABLE, good);
    expect(r.ok).toBe(true);
    expect(writes()).not.toMatch(/accepted_at/i);
    expect(writes()).not.toMatch(/UPDATE project_deliverables/i);
  });

  it('is tenant_admin only — a claim about somebody outside the company is narrower than an upload', async () => {
    const r = await fileAcceptanceEvidence(EMPLOYEE, PROJECT, DELIVERABLE, good);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(db.state.queries, 'refused before touching anything').toEqual([]);
  });
});

describe('the reported name is never the verified actor', () => {
  it('keeps filedBy and customerName as SEPARATE fields on the event', async () => {
    // Merged into one `acceptedBy`, the record would read as the customer's own act — a clean,
    // confident, wrong sentence exactly when a dispute is reading it.
    ok();
    await fileAcceptanceEvidence(ADMIN, PROJECT, DELIVERABLE, good);
    const ev = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'acceptance_evidence.filed');
    expect(ev, 'the filing is on the record').toBeTruthy();
    const payload = ev![0].payload as Record<string, unknown>;
    expect(payload.filedBy, 'the verified actor is a user id').toBe('u-admin');
    expect(payload.customerName, 'the reported name is a string somebody typed').toBe('J. Rivera');
    expect(payload).not.toHaveProperty('acceptedBy');
  });

  it('stores the customer as free text, with no attempt to resolve them to a user', async () => {
    // Inventing a user row for a COR would manufacture an identity nothing checked.
    ok();
    await fileAcceptanceEvidence(ADMIN, PROJECT, DELIVERABLE, good);
    expect(db.state.queries.some((q) => /FROM users/i.test(q)),
      'no lookup — this person is not in the product').toBe(false);
  });
});

describe('the anchor and the file', () => {
  it('scopes the deliverable through its milestone to THIS project', async () => {
    db.state.results = [[]];
    const r = await fileAcceptanceEvidence(ADMIN, PROJECT, DELIVERABLE, good);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
    const probe = db.state.queries.find((q) => /project_deliverables/i.test(q)) ?? '';
    expect(probe).toMatch(/m\.project_id = \?/);
    expect(probe).toMatch(/d\.tenant_id = \?/);
  });

  it('refuses an extension outside the allowed set', async () => {
    const r = await fileAcceptanceEvidence(ADMIN, PROJECT, DELIVERABLE, { ...good, filename: 'x.exe' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('VALIDATION_ERROR');
  });

  it('refuses an unknown kind — "evidence" with no kind is a filing cabinet', async () => {
    const r = await fileAcceptanceEvidence(ADMIN, PROJECT, DELIVERABLE, { ...good, kind: 'vibes' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/kind must be one of/);
  });

  it('refuses an empty file rather than storing zero bytes as proof', async () => {
    const r = await fileAcceptanceEvidence(ADMIN, PROJECT, DELIVERABLE, { ...good, body: Buffer.alloc(0) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/empty/i);
  });

  it('never lets a user-supplied filename reach the object key', async () => {
    ok();
    await fileAcceptanceEvidence(ADMIN, PROJECT, DELIVERABLE, { ...good, filename: 'COR reply.eml' });
    const insert = db.state.queries.findIndex((q) => /INSERT INTO project_acceptance_evidence/i.test(q));
    const key = String(db.state.values[insert].find((v) => typeof v === 'string' && v.includes('evidence/')));
    expect(key).not.toContain('COR reply');
    expect(key, 'id-derived, and it keeps the extension').toMatch(/\.eml$/);
  });
});
