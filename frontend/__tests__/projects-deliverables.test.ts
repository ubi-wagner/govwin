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
  const state = { queries: [] as string[], results: [] as unknown[][], values: [] as unknown[][] };
  const tagged = (strings: TemplateStringsArray, ...values: unknown[]) => {
    state.queries.push(strings.raw.join(' ? ').replace(/\s+/g, ' ').trim());
    // The VALUES too, not only the SQL text. Most assertions in this file are about predicates, but
    // what a starter canvas CONTAINS is a value — and a check that can only see the query string
    // reads an INSERT of an empty document as identical to an INSERT of a real one.
    state.values.push(values);
    return Promise.resolve(state.results.shift() ?? []);
  };
  // `sql.json` is a passthrough here: the production call exists to stop postgres.js stringifying a
  // jsonb value into a string that char-iterates on read, which is a driver concern, not a logic one.
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

import { markMilestoneMet, uploadDeliverable, acceptDeliverable, authorDeliverable } from '@/lib/projects/milestones';
import { emitEventSingle } from '@/lib/events';

const ADMIN = { userId: 'u1', role: 'tenant_admin', tenantId: 't1' };
const EMPLOYEE = { userId: 'u2', role: 'tenant_user', tenantId: 't1' };
const PROJECT = '22222222-2222-4222-8222-222222222222';
const DELIVERABLE = '44444444-4444-4444-8444-444444444444';
const MILESTONE = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  db.state.queries.length = 0;
  db.state.values.length = 0;
  db.state.results = [];
  vi.mocked(emitEventSingle).mockClear();
});

const writes = () => db.state.queries.filter((q) => /^UPDATE|^INSERT/i.test(q)).join(' ');
const all = () => db.state.queries.join(' ');

// ── the milestone gate ───────────────────────────────────────────────────────────────────────


/**
 * ── THE QUEUE GREW A ROW: THE TASK GATE COMES FIRST (mig 218) ────────────────────────────────
 * `markMilestoneMet` now asks TWO questions before it closes anything: is the work done (open
 * tasks) and has the customer accepted the evidence (unaccepted deliverables). They are separate
 * refusals with separate messages because they are different problems with different next actions.
 *
 * That means the mock's result queue starts one entry earlier. Every case below leads with `[]` —
 * "no open tasks" — so these cases keep testing what they were written to test. The new gate has
 * its own case, first.
 */
describe('markMilestoneMet', () => {
  it('REFUSES while a TASK on it is not done — the work, before the acceptance', async () => {
    db.state.results = [[{ title: 'CDR slide package' }, { title: 'Vendor lead times' }]];
    const r = await markMilestoneMet(ADMIN, PROJECT, MILESTONE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('TASKS_OUTSTANDING');
      expect(r.status).toBe(409);
      // It names them. "The milestone is not ready" tells nobody what to go and do.
      expect(r.error).toContain('CDR slide package');
    }
  });

  it('REFUSES while a deliverable on it is unaccepted, and names them', async () => {
    // The headline. A milestone whose deliverables nobody approved is not met — it is a milestone
    // we believe we have finished, which is a different claim and the one that gets contractors
    // into trouble.
    db.state.results = [[], [{ title: 'Q1 technical report' }, { title: 'Test plan' }]];
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
    db.state.results = [[], []];
    await markMilestoneMet(ADMIN, PROJECT, MILESTONE).catch(() => {});
    // Selected by WHAT IT READS, not by position. It used to be `queries[0]`, and adding the
    // open-tasks gate in front of it silently repointed this assertion at a different query — the
    // check would have kept passing while testing the wrong statement.
    const probe = db.state.queries.find((q: string) => /project_deliverables/i.test(q)) ?? '';
    expect(probe, 'the deliverables gate ran at all').not.toBe('');
    expect(probe).toMatch(/accepted_at IS NULL/i);
    expect(probe, 'a present storage_key must not satisfy the gate').not.toMatch(/storage_key IS NOT NULL/i);
  });

  it('closes by compare-and-swap, so a double-click cannot stamp two met_at values', async () => {
    db.state.results = [[], [], [{ id: MILESTONE, title: 'Kickoff', baselineDate: '2026-03-01', metAt: '2026-03-10T00:00:00.000Z', status: 'met' }]];
    const r = await markMilestoneMet(ADMIN, PROJECT, MILESTONE);
    expect(r.ok).toBe(true);
    expect(writes()).toMatch(/status = 'pending'/i);
  });

  it('carries the variance in the event rather than leaving a reader to subtract two dates', async () => {
    db.state.results = [[], [], [{ id: MILESTONE, title: 'Kickoff', baselineDate: '2026-03-01', metAt: '2026-03-10T00:00:00.000Z', status: 'met' }]];
    await markMilestoneMet(ADMIN, PROJECT, MILESTONE);
    const payload = vi.mocked(emitEventSingle).mock.calls[0][0].payload as Record<string, unknown>;
    expect(payload.varianceDays).toBe(9);
  });

  it('answers a clear 409 when the milestone is not pending', async () => {
    db.state.results = [[], [], []];
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

  /**
   * ── EVIDENCE IS NOW A FILE **OR** AN AUTHORED DOCUMENT (mig 220) ───────────────────────────
   * A deliverable can be satisfied by an upload or by a canvas document written in-product, so the
   * refusal is `NOTHING_ATTACHED` rather than `NOTHING_UPLOADED` — and its message has to name both
   * ways out, because "upload one first" is wrong advice to give someone whose deliverable is a
   * report they are meant to write here.
   *
   * What did NOT widen is acceptance. Authoring attaches evidence exactly as uploading does; the
   * separate, deliberate `accepted_at` act is untouched, which is the whole point of this file.
   */
  it('refuses when there is nothing attached to accept — neither file nor document', async () => {
    db.state.results = [[], [{ storageKey: null, documentId: null, acceptedAt: null }]];
    const r = await acceptDeliverable(ADMIN, PROJECT, DELIVERABLE);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('NOTHING_ATTACHED');
      expect(r.error, 'the message must name BOTH ways to attach evidence')
        .toMatch(/Upload a file or author the document/i);
    }
  });

  it('a deliverable backed only by an AUTHORED DOCUMENT is acceptable', async () => {
    // The half that would silently regress: if the CAS still demanded a `storage_key`, a report
    // written in the canvas editor could never be accepted, and the refusal would say there is
    // nothing attached — while the document sits right there on the row.
    db.state.results = [[{
      id: DELIVERABLE, title: 'Q1 technical report', acceptedAt: '2026-03-02',
      filename: null, storageKey: null, documentId: '77777777-7777-4777-8777-777777777777',
    }]];
    const r = await acceptDeliverable(ADMIN, PROJECT, DELIVERABLE);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.documentId).toBe('77777777-7777-4777-8777-777777777777');
  });

  it('refuses a double-accept', async () => {
    db.state.results = [[], [{ storageKey: 'k', documentId: null, acceptedAt: '2026-03-01T00:00:00.000Z' }]];
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
    // The evidence arm is an OR of the two attachments — an AND here would make an authored
    // document unacceptable, and a missing arm would let an empty deliverable close a milestone.
    expect(cas).toMatch(/d\.storage_key IS NOT NULL OR d\.document_id IS NOT NULL/i);
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

/**
 * ── AUTHORING: A BLANK PAGE IS NOT A DRAFT ───────────────────────────────────────────────────
 *
 * This shipped, and every check passed it. `starterFromPreset` builds an EMPTY canvas — correct for
 * the "New document" chooser, where someone clicked "blank letter" and means it — so the authored
 * deliverable exported as a blank page. The drive asserted HTTP 200 and the file's magic number,
 * and an empty PDF is still 200 and still starts `%PDF`: an 865-byte nothing passed as evidence.
 *
 * The tell was in the database the whole time — `tenant_documents.node_count = 0` — which no
 * assertion looked at, because the ones that existed were about the ROUTE rather than the artifact.
 *
 * What goes on the page is bounded on the other side too: only facts read from a row. Scaffolding
 * plausible section headings would make the starter look more finished while putting structure into
 * a contract deliverable that nobody asked for — the same rule the ingest spine runs on.
 */
describe('authorDeliverable — the starter carries what the system knows', () => {
  const FACTS = {
    id: DELIVERABLE, title: 'Monthly technical report', documentId: null,
    requiredBy: new Date('2026-06-30T00:00:00.000Z'), milestone: 'Execution', project: 'USAF SBIR Phase II',
  };
  /**
   * The CANVAS value handed to the INSERT — not the whole parameter list.
   *
   * The distinction is load-bearing and was got wrong first: stringifying every value also picks up
   * the `title` COLUMN, which carries the deliverable's name whether or not a single node exists.
   * Asserting against that made "names the deliverable" pass on a blank document — an instrument
   * agreeing with the defect it was written to catch. Selected by SHAPE (the value with a `nodes`
   * array), so it cannot silently repoint if the column order changes.
   */
  const insertedCanvas = () => {
    const i = db.state.queries.findIndex((q) => /INSERT INTO tenant_documents/i.test(q));
    expect(i, 'the document was inserted at all').toBeGreaterThan(-1);
    const canvas = db.state.values[i].find(
      (v): v is { nodes: unknown[] } => Boolean(v) && Array.isArray((v as { nodes?: unknown }).nodes),
    );
    expect(canvas, 'a canvas value reached the INSERT').toBeTruthy();
    // The NODES, not the whole canvas. `starterFromPreset` writes the title into `metadata.title`
    // of even an empty document, so a check against the canvas as a whole finds the deliverable's
    // name on a blank page and passes — the same way the title column did, one layer in. Only
    // nodes are printed, so only nodes answer "does the page say it".
    return JSON.stringify((canvas as { nodes: unknown[] }).nodes);
  };

  it('is not a blank page', async () => {
    db.state.results = [[FACTS]];
    const r = await authorDeliverable(ADMIN, PROJECT, DELIVERABLE, { preset: 'letter' });
    expect(r.ok).toBe(true);
    expect(JSON.parse(insertedCanvas()).length).toBeGreaterThan(0);
  });

  it('names the deliverable it satisfies', async () => {
    db.state.results = [[FACTS]];
    await authorDeliverable(ADMIN, PROJECT, DELIVERABLE, { preset: 'letter' });
    expect(insertedCanvas()).toContain('Monthly technical report');
  });

  it('carries the project, the phase and the due date — read from the row', async () => {
    db.state.results = [[FACTS]];
    await authorDeliverable(ADMIN, PROJECT, DELIVERABLE, { preset: 'letter' });
    const canvas = insertedCanvas();
    expect(canvas).toContain('USAF SBIR Phase II');
    expect(canvas).toContain('Execution');
    // A `date` column arrives as a JavaScript Date. `String(d).slice(0,10)` is "Tue Jun 30" — the
    // #2 crash class in this repo, and a fixture of ISO strings would pass against the broken code,
    // so the fixture above is a real Date.
    expect(canvas).toContain('Required by 2026-06-30');
  });

  it('invents nothing — no scaffolded section headings', async () => {
    db.state.results = [[FACTS]];
    await authorDeliverable(ADMIN, PROJECT, DELIVERABLE, { preset: 'letter' });
    const canvas = insertedCanvas();
    for (const invented of ['Introduction', 'Background', 'Approach', 'Conclusion']) {
      expect(canvas, `"${invented}" was never read from a row`).not.toContain(invented);
    }
  });

  it('still refuses a second draft', async () => {
    db.state.results = [[{ ...FACTS, documentId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }]];
    const r = await authorDeliverable(ADMIN, PROJECT, DELIVERABLE, { preset: 'deck' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('ALREADY_AUTHORED');
    expect(writes(), 'a refusal writes nothing').toBe('');
  });
});
