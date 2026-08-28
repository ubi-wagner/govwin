/**
 * INVOICING — where the capability becomes money, and where being wrong costs something.
 *
 * Three things are worth a test here and the rest is plumbing:
 *
 *  1. **The ceiling holds across invoices.** Three invoices each comfortably under the funded
 *     amount can sum to twice it, and each looks correct at the moment it is submitted.
 *  2. **The same hours cannot be billed twice**, and voiding RELEASES them — otherwise a corrected
 *     invoice can never re-bill the work it was correcting.
 *  3. **Submitted is not paid**, and a partial payment does not settle the claim.
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
  const client = Object.assign(tagged, { state, json: (v: unknown) => v });
  return { db: { sqlMock: client, state } };
});

vi.mock('@/lib/db', () => ({ sql: db.sqlMock, auditLog: vi.fn(async () => {}) }));
vi.mock('@/lib/rls', () => ({
  withTenant: async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(db.sqlMock),
}));
vi.mock('@/lib/events', () => ({
  emitEventSingle: vi.fn(async () => {}),
  userActor: (id: string) => ({ type: 'user', id }),
}));
vi.mock('@/lib/projects/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/access')>()),
  canAccessProject: vi.fn(async () => true),
}));

import {
  draftInvoice, submitInvoice, recordPayment, voidInvoice, daysOutstanding,
} from '@/lib/projects/invoices';
import { emitEventSingle } from '@/lib/events';

const ADMIN = { userId: 'u-admin', role: 'tenant_admin', tenantId: 't1' };
const EMPLOYEE = { userId: 'u-emp', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const CLIN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INV = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ENTRY = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const line = { clinId: CLIN, description: 'April labour', source: 'labour', amount: 100000 };

const writes = () => db.state.queries.filter((q) => /^(INSERT|UPDATE|DELETE)/i.test(q)).join(' ');

/** The four reads `clinBilling` + `submitInvoice` make, in order. */
const submitFixture = (opts: { funded: number; alreadyBilled: number; mine: number }) => {
  db.state.results = [
    [{ id: INV, invoiceNumber: 'INV-001', status: 'draft' }],       // the invoice
    [{ clinId: CLIN, amount: String(opts.mine) }],                  // its lines, per CLIN
    [{ clinId: CLIN, clinNumber: '0001', fundedAmount: String(opts.funded),
       billed: String(opts.alreadyBilled), paid: '0' }],            // clinBilling
    [{ id: INV }],                                                  // the CAS flip
  ];
};

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
});

// ── the ceiling ──────────────────────────────────────────────────────────────────────────────

describe('you cannot bill past what the contract funded', () => {
  it('refuses, and says by HOW MUCH', async () => {
    // "Over the funding" with no number sends somebody to a spreadsheet to work out what this code
    // already knew.
    submitFixture({ funded: 750000, alreadyBilled: 700000, mine: 100000 });
    const r = await submitInvoice(ADMIN, PROJECT, INV, { submittedOn: '2026-06-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('OVER_FUNDED_CEILING');
      expect(r.error).toMatch(/50000\.00 over/);
      expect(r.error, 'and says what to do about it').toMatch(/modification/i);
    }
    expect(writes(), 'nothing is claimed on a refusal').not.toMatch(/UPDATE project_invoices/i);
  });

  it('checks CUMULATIVE billing, not this invoice alone', async () => {
    // The one that matters. Three invoices of $300k against $750k funded are each under the limit
    // and together are over it, and each looks correct at the moment it is submitted.
    submitFixture({ funded: 750000, alreadyBilled: 600000, mine: 300000 });
    const r = await submitInvoice(ADMIN, PROJECT, INV, { submittedOn: '2026-06-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/150000\.00 over/);
  });

  it('allows one that fits exactly — a ceiling is a limit, not a margin', async () => {
    submitFixture({ funded: 750000, alreadyBilled: 650000, mine: 100000 });
    const r = await submitInvoice(ADMIN, PROJECT, INV, { submittedOn: '2026-06-01' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.total).toBe(100000);
  });

  it('reports rather than blocks when the CLIN has no funded amount', async () => {
    // A gap in the contract data is not permission to bill infinity — but refusing here would block
    // every invoice on a project whose funding has not been entered yet.
    submitFixture({ funded: 0, alreadyBilled: 0, mine: 100000 });
    db.state.results[2] = [{ clinId: CLIN, clinNumber: '0001', fundedAmount: null, billed: '0', paid: '0' }];
    const r = await submitInvoice(ADMIN, PROJECT, INV, { submittedOn: '2026-06-01' });
    expect(r.ok).toBe(true);
  });

  it('requires a submission date — the ageing report is wrong without it', async () => {
    const r = await submitInvoice(ADMIN, PROJECT, INV, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/YYYY-MM-DD|submission date/);
    expect(db.state.queries).toEqual([]);
  });

  it('refuses an invoice with no lines', async () => {
    db.state.results = [[{ id: INV, invoiceNumber: 'INV-001', status: 'draft' }], []];
    const r = await submitInvoice(ADMIN, PROJECT, INV, { submittedOn: '2026-06-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NO_LINES');
  });

  it('claims by compare-and-swap, so two submissions cannot both go out', async () => {
    submitFixture({ funded: 750000, alreadyBilled: 0, mine: 100000 });
    await submitInvoice(ADMIN, PROJECT, INV, { submittedOn: '2026-06-01' });
    const flip = db.state.queries.find((q) => /UPDATE project_invoices/i.test(q)) ?? '';
    expect(flip).toMatch(/status = 'draft'/i);
  });
});

// ── the hours ────────────────────────────────────────────────────────────────────────────────

describe('the same hours cannot be billed twice', () => {
  it('claims the time entries with an APPROVED and UNBILLED predicate', async () => {
    // In the predicate, not checked first: a concurrent invoice racing for the same entries loses
    // by matching zero rows, rather than both marking them.
    db.state.results = [
      [{ id: CLIN }],                       // owned CLINs
      [{ id: INV, invoiceNumber: 'INV-001' }],   // the invoice
      [{ id: 'line-1' }],                   // the line
      [],                                   // the time-entry claim
    ];
    const r = await draftInvoice(ADMIN, PROJECT, {
      invoiceNumber: 'INV-001', lines: [{ ...line, timeEntryIds: [ENTRY] }],
    });
    expect(r.ok).toBe(true);
    const claim = db.state.queries.find((q) => /UPDATE project_time_entries/i.test(q)) ?? '';
    expect(claim).toMatch(/approved_at IS NOT NULL/i);
    expect(claim).toMatch(/invoice_line_id IS NULL/i);
    expect(claim).toMatch(/project_id = \?/);
    expect(claim).toMatch(/tenant_id = \?/);
  });

  it('VOIDING releases them — otherwise the corrected invoice can never re-bill the work', async () => {
    db.state.results = [
      [{ id: INV, invoiceNumber: 'INV-001' }],
      [{ id: ENTRY }, { id: 'e2' }],
    ];
    const r = await voidInvoice(ADMIN, PROJECT, INV, 'Billed against the wrong CLIN');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.hoursReleased).toBe(2);
    const release = db.state.queries.find((q) => /SET invoice_line_id = NULL/i.test(q)) ?? '';
    expect(release).toBeTruthy();
  });

  it('a void needs a reason', async () => {
    const r = await voidInvoice(ADMIN, PROJECT, INV, '   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/reason/i);
    expect(db.state.queries).toEqual([]);
  });

  it('and the void is scoped to a NOT-already-void invoice', async () => {
    db.state.results = [[], []];
    await voidInvoice(ADMIN, PROJECT, INV, 'duplicate');
    const upd = db.state.queries.find((q) => /UPDATE project_invoices/i.test(q)) ?? '';
    expect(upd).toMatch(/status <> 'void'/i);
  });
});

// ── drafting ─────────────────────────────────────────────────────────────────────────────────

describe('drafting', () => {
  it('is refused for an employee', async () => {
    const r = await draftInvoice(EMPLOYEE, PROJECT, { invoiceNumber: 'INV-1', lines: [line] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(403);
    expect(db.state.queries).toEqual([]);
  });

  it('REFUSES a CLIN from another project', async () => {
    db.state.results = [[], []];
    const r = await draftInvoice(ADMIN, PROJECT, { invoiceNumber: 'INV-1', lines: [line] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/does not belong to this project/);
    expect(writes()).toBe('');
  });

  it('refuses an invoice with no lines', async () => {
    const r = await draftInvoice(ADMIN, PROJECT, { invoiceNumber: 'INV-1', lines: [] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/at least one line/);
  });

  it('refuses a ZERO line — a line nobody meant to add', async () => {
    db.state.results = [[{ id: CLIN }], []];
    const r = await draftInvoice(ADMIN, PROJECT, {
      invoiceNumber: 'INV-1', lines: [{ ...line, amount: 0 }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/zero line/);
  });

  it('ALLOWS a negative line — a retroactive adjustment is how a correction is made', async () => {
    // Three reads, not four: the milestone lookup is SKIPPED when no line names one, so a fixture
    // with a spare row feeds an empty result to the INSERT and the module 500s on a row that is
    // not there. The finding was the fixture.
    db.state.results = [[{ id: CLIN }], [{ id: INV }], [{ id: 'l1' }]];
    const r = await draftInvoice(ADMIN, PROJECT, {
      invoiceNumber: 'INV-2', lines: [{ ...line, amount: -5000, description: 'Credit: April overbill' }],
    });
    expect(r.ok).toBe(true);
  });
});

// ── payment ──────────────────────────────────────────────────────────────────────────────────

describe('submitted is not paid', () => {
  it('refuses payment against a DRAFT', async () => {
    db.state.results = [[{ id: INV, invoiceNumber: 'INV-001', status: 'draft', amountPaid: '0' }]];
    const r = await recordPayment(ADMIN, PROJECT, INV, { amount: 1000, paidOn: '2026-07-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NOT_SUBMITTED');
      expect(r.error).toMatch(/nobody made/);
    }
  });

  it('a PARTIAL payment does not settle the claim', async () => {
    // The withholding case, which is the normal one. Marking it paid is what makes somebody stop
    // chasing the last 10%.
    db.state.results = [
      [{ id: INV, invoiceNumber: 'INV-001', status: 'submitted', amountPaid: '0' }],
      [{ total: '100000' }],
      [{ id: INV }],
    ];
    const r = await recordPayment(ADMIN, PROJECT, INV, { amount: 90000, paidOn: '2026-07-01' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.settled).toBe(false);
      expect(r.data.amountPaid).toBe(90000);
    }
    const upd = db.state.queries.find((q) => /UPDATE project_invoices/i.test(q)) ?? '';
    const i = db.state.queries.indexOf(upd);
    expect(db.state.values[i], 'it stays submitted').toContain('submitted');
  });

  it('ACCUMULATES payments, so the withholding settles it', async () => {
    db.state.results = [
      [{ id: INV, invoiceNumber: 'INV-001', status: 'submitted', amountPaid: '90000' }],
      [{ total: '100000' }],
      [{ id: INV }],
    ];
    const r = await recordPayment(ADMIN, PROJECT, INV, { amount: 10000, paidOn: '2026-09-01' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.amountPaid).toBe(100000);
      expect(r.data.settled).toBe(true);
    }
  });

  it('the event says whether it SETTLED, not just that money arrived', async () => {
    db.state.results = [
      [{ id: INV, invoiceNumber: 'INV-001', status: 'submitted', amountPaid: '0' }],
      [{ total: '100000' }],
      [{ id: INV }],
    ];
    await recordPayment(ADMIN, PROJECT, INV, { amount: 90000, paidOn: '2026-07-01' });
    const ev = vi.mocked(emitEventSingle).mock.calls.find((c) => c[0].type === 'invoice.paid');
    const p = ev![0].payload as Record<string, unknown>;
    expect(p.settled).toBe(false);
    expect(p.amountPaid).toBe(90000);
    expect(p.total).toBe(100000);
  });

  it('refuses a payment against a VOID invoice', async () => {
    db.state.results = [[{ id: INV, invoiceNumber: 'INV-001', status: 'void', amountPaid: '0' }]];
    const r = await recordPayment(ADMIN, PROJECT, INV, { amount: 1000, paidOn: '2026-07-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('INVOICE_VOID');
  });
});

// ── ageing ───────────────────────────────────────────────────────────────────────────────────

describe('days outstanding', () => {
  const today = new Date('2026-07-15T09:00:00Z');

  it('counts from the SUBMITTED date', () => {
    expect(daysOutstanding({ status: 'submitted', submittedOn: '2026-06-15' }, today)).toBe(30);
  });

  it('handles a `date` column arriving as a JavaScript Date', () => {
    // The #2 crash class in this codebase. `String(d).slice(0,10)` is "Mon Jun 15", which
    // `Date.parse` turns into NaN — and NaN survives every comparison to render as a confident
    // number. A fixture of ISO strings passes against the broken code, so this one is a real Date.
    const asDate = new Date('2026-06-15T00:00:00Z') as unknown as string;
    expect(daysOutstanding({ status: 'submitted', submittedOn: asDate }, today)).toBe(30);
  });

  it('is null for anything not outstanding — never a confident 0', () => {
    expect(daysOutstanding({ status: 'draft', submittedOn: null }, today)).toBeNull();
    expect(daysOutstanding({ status: 'paid', submittedOn: '2026-06-15' }, today)).toBeNull();
  });
});
