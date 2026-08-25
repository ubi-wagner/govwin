/**
 * TEST-02 — stripe/webhook route handler
 *
 * Strategy: vi.mock the entire @/lib/stripe module so that `stripe` is a
 * mock object with a controllable `webhooks.constructEvent`.  Also mock
 * @/lib/db (sql + sql.begin) and @/lib/events (emitEventSingle).
 *
 * Because Next.js route handlers are plain async functions exported from a
 * module, we import POST directly after all vi.mock() calls are hoisted.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock factories ────────────────────────────────────────────
// vi.hoisted runs before imports so the factories are available in vi.mock.
const { constructEventMock, sqlMock, sqlBeginMock, emitEventSingleMock } = vi.hoisted(() => {
  const constructEventMock = vi.fn();
  const sqlBeginMock = vi.fn();
  // sql is also a function (tagged template) AND has .begin on it
  const sqlMock = Object.assign(vi.fn(), { begin: sqlBeginMock });
  const emitEventSingleMock = vi.fn();
  return { constructEventMock, sqlMock, sqlBeginMock, emitEventSingleMock };
});

// ─── Mocks ─────────────────────────────────────────────────────────────

// Mock the entire stripe lib so `stripe` is a non-null object
vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: constructEventMock,
    },
  },
  getAmountCents: (productType: string) => {
    const amounts: Record<string, number> = {
      proposal_phase1: 199900,
      proposal_phase2: 499900,
      finder_subscription: 49900,
      expert_consulting: 50000,
    };
    return amounts[productType] ?? 0;
  },
}));

vi.mock('@/lib/rls', () => ({ withTenant: (_t, fn) => fn(sqlMock) }));
vi.mock('@/lib/db', () => ({ enterTenant: () => {}, enterBypass: () => {},
  sql: sqlMock,
  sqlBypass: sqlMock,
}));

vi.mock('@/lib/events', () => ({
  emitEventSingle: emitEventSingleMock,
  systemActor: (id: string) => ({ type: 'system', id }),
}));

// Import the route AFTER mocks are registered
import { POST } from '@/app/api/stripe/webhook/route';

// ─── Helpers ───────────────────────────────────────────────────────────

function makeRequest(body: string, sig = 'valid-sig'): Request {
  return new Request('http://localhost/api/stripe/webhook', {
    method: 'POST',
    headers: { 'stripe-signature': sig },
    body,
  });
}

function makeCheckoutSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cs_test_123',
    payment_intent: 'pi_test_456',
    metadata: {
      tenant_id: 'tenant-uuid-111',
      product_type: 'proposal_phase1',
      opportunity_id: 'opp-uuid-222',
      quantity: '1',
    },
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('POST /api/stripe/webhook', () => {
  beforeEach(() => {
    constructEventMock.mockReset();
    sqlMock.mockReset();
    sqlBeginMock.mockReset();
    emitEventSingleMock.mockReset();
    // Default: emitEventSingle is a no-op success
    emitEventSingleMock.mockResolvedValue(undefined);
    // Restore STRIPE_WEBHOOK_SECRET for each test
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
  });

  // ── (a) Invalid / missing signature → 400 ───────────────────────────

  it('returns 400 when stripe-signature header is missing', async () => {
    const req = new Request('http://localhost/api/stripe/webhook', {
      method: 'POST',
      body: 'body',
      // no stripe-signature header
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when constructEvent throws (bad signature)', async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });

    const res = await POST(makeRequest('{"id":"evt_bad"}', 'bad-sig'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid signature/i);
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  /**
   * DELIBERATE BEHAVIOUR CHANGE (was 500 / `DB_ERROR`).
   *
   * Missing Stripe keys is a DEPLOYMENT condition, not a fault, and nothing on this path touches a
   * database — so `DB_ERROR` was wrong twice and disagreed with the two sibling routes
   * (stripe/checkout, stripe/portal), which have always answered `STRIPE_NOT_CONFIGURED` for
   * exactly this. 503 is the honest status for "not configured yet".
   *
   * Safe for the one caller that matters: Stripe retries the whole 5xx class, so 500 → 503 does not
   * change whether an event is redelivered — the events still replay once the keys are set, rather
   * than being swallowed by a 200. The assertion now pins the `code`, which is the part a caller
   * branches on and the part that was actually wrong.
   */
  it('returns 503 STRIPE_NOT_CONFIGURED when STRIPE_WEBHOOK_SECRET is not set', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await POST(makeRequest('body'));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toMatch(/Webhook secret not configured/i);
    expect(json.code).toBe('STRIPE_NOT_CONFIGURED');
  });

  // ── (b) Valid checkout.session.completed → purchases row + event ────

  it('valid checkout.session.completed creates purchase row and emits purchase.completed', async () => {
    const session = makeCheckoutSession();

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: session },
    });

    // sql is called as a tagged template. The first call is the idempotency check
    // (SELECT id FROM purchases WHERE stripe_session_id = ...) — return empty (no existing).
    // The second call (sql.begin) runs the INSERT.
    sqlMock.mockResolvedValueOnce([]); // idempotency check → no existing row

    // sql.begin receives an async callback; we call it with a mock tx
    sqlBeginMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txMock = vi.fn().mockResolvedValue([{ id: 'new-purchase-id' }]);
      return cb(txMock);
    });

    const res = await POST(makeRequest(JSON.stringify({ type: 'checkout.session.completed' })));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);

    // Confirm sql.begin was called (transaction was entered)
    expect(sqlBeginMock).toHaveBeenCalledOnce();

    // Confirm the event was emitted with purchase.completed for proposal_phase1
    expect(emitEventSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'capture',
        type: 'purchase.completed',
        tenantId: 'tenant-uuid-111',
      }),
    );
  });

  it('skips insert and returns 200 when session already exists (idempotency)', async () => {
    const session = makeCheckoutSession();

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: session },
    });

    // Idempotency check returns an existing row
    sqlMock.mockResolvedValueOnce([{ id: 'existing-purchase-id' }]);

    const res = await POST(makeRequest('body'));
    expect(res.status).toBe(200);

    // sql.begin should NOT have been called since we returned early
    expect(sqlBeginMock).not.toHaveBeenCalled();
    // No event emitted either
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });

  it('emits subscription.started for finder_subscription productType', async () => {
    const session = makeCheckoutSession({
      metadata: {
        tenant_id: 'tenant-uuid-111',
        product_type: 'finder_subscription',
        opportunity_id: null,
        quantity: '1',
      },
    });

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: session },
    });

    sqlMock.mockResolvedValueOnce([]); // no existing purchase

    sqlBeginMock.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      const txMock = vi.fn().mockResolvedValue([]);
      return cb(txMock);
    });

    await POST(makeRequest('body'));

    expect(emitEventSingleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'capture',
        type: 'subscription.started',
      }),
    );
  });

  it('returns 200 (not 500) when missing required metadata (permanent error, no retry)', async () => {
    const session = makeCheckoutSession({
      metadata: {}, // missing tenant_id and product_type
    });

    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: session },
    });

    // No sql calls expected since handler returns early when metadata is missing
    const res = await POST(makeRequest('body'));
    expect(res.status).toBe(200);
    expect(sqlBeginMock).not.toHaveBeenCalled();
  });

  // ── (c) DB error mid-transaction → 500 so Stripe retries ────────────

  it('DB error during idempotency check throws 500 (transient → Stripe retries)', async () => {
    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: makeCheckoutSession() },
    });

    // Simulate a DB connection error
    const dbError = new Error('ECONNREFUSED 127.0.0.1:5432');
    sqlMock.mockRejectedValueOnce(dbError);

    const res = await POST(makeRequest('body'));
    // Transient DB error → 500 so Stripe retries
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe('DB_ERROR');

    // sql.begin should NOT have been reached
    expect(sqlBeginMock).not.toHaveBeenCalled();
  });

  it('DB error during sql.begin transaction → 500 (transient, no partial state)', async () => {
    constructEventMock.mockReturnValue({
      type: 'checkout.session.completed',
      data: { object: makeCheckoutSession() },
    });

    sqlMock.mockResolvedValueOnce([]); // idempotency check succeeds (no existing row)

    // sql.begin throws a database error (simulates tx rollback)
    const txError = new Error('database connection lost');
    sqlBeginMock.mockRejectedValueOnce(txError);

    const res = await POST(makeRequest('body'));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.code).toBe('DB_ERROR');

    // Event should NOT have been emitted (tx failed before event emission)
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });

  // ── Unhandled event types → acknowledge receipt without error ────────

  it('unhandled event types return 200 received:true without any DB writes', async () => {
    constructEventMock.mockReturnValue({
      type: 'payment_intent.created',
      data: { object: {} },
    });

    const res = await POST(makeRequest('body'));
    expect(res.status).toBe(200);
    expect((await res.json()).received).toBe(true);
    expect(sqlMock).not.toHaveBeenCalled();
    expect(emitEventSingleMock).not.toHaveBeenCalled();
  });
});
