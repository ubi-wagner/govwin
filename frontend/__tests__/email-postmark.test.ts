/**
 * The Postmark driver and the delivery webhook — the two halves of "did it actually land".
 *
 * The driver is asserted against a stubbed `fetch` rather than the emulator, because a unit test
 * should fail for one reason. The emulator proves the wiring end to end
 * (`scripts/test-harness/emulated-postmark.mjs` + `drive-email-spine.mjs`); this proves the request
 * body and, more importantly, the ERROR TRANSLATIONS — which is where a provider integration
 * actually costs people time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { emitted, suppressed, ledgerRow } = vi.hoisted(() => ({
  emitted: [] as Array<{ type: string; tenantId: string | null; payload: Record<string, unknown> }>,
  suppressed: [] as Array<{ email: string; reason: string }>,
  ledgerRow: { current: null as null | { id: string; tenantId: string | null; correlationId: string; template: string | null } },
}));

vi.mock('@/lib/events', () => ({
  emitEventSingle: vi.fn(async (p: { type: string; tenantId: string | null; payload: Record<string, unknown> }) => {
    emitted.push({ type: p.type, tenantId: p.tenantId, payload: p.payload });
  }),
  systemActor: (id: string) => ({ type: 'system', id }),
}));

vi.mock('@/lib/email', () => ({
  findSend: vi.fn(async () => ledgerRow.current),
  suppress: vi.fn(async (p: { email: string; reason: string }) => { suppressed.push(p); return true; }),
}));

import { postmarkDriver } from '@/lib/email/drivers/postmark';
import { POST as webhook } from '@/app/api/webhooks/postmark/route';
import type { ResolvedMessage } from '@/lib/email/types';

const message: ResolvedMessage = {
  to: 'kate@example.test',
  subject: 'Your proposal is ready',
  html: '<p>Open it <a href="https://x.test/p/1">here</a></p>',
  text: 'Open it here (https://x.test/p/1)',
  kind: 'transactional',
  sender: {
    fromAddress: 'notifications@rfppipeline.com',
    fromName: 'Kate Ulepic via RFP Pipeline',
    replyTo: 'kate@foundation3dp.test',
    stream: 'outbound',
  },
  correlationId: '33333333-3333-4333-8333-333333333333',
  idempotencyKey: 'evt-1',
  tenantId: '11111111-1111-4111-8111-111111111111',
  template: 'proposal_ready',
  tags: ['proposal'],
  metadata: { correlation_id: '33333333-3333-4333-8333-333333333333', proposal_id: 'p1' },
};

const realFetch = globalThis.fetch;
let lastRequest: { url: string; init: RequestInit } | null = null;

function stubFetch(status: number, body: unknown) {
  globalThis.fetch = vi.fn(async (url: string, init: RequestInit) => {
    lastRequest = { url: String(url), init };
    return { ok: status < 400, status, statusText: 'x', json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  emitted.length = 0;
  suppressed.length = 0;
  ledgerRow.current = null;
  lastRequest = null;
  process.env.POSTMARK_SERVER_TOKEN = 'server-token';
  process.env.POSTMARK_WEBHOOK_SECRET = 'hook-secret';
  delete process.env.POSTMARK_API_BASE;
});

afterEach(() => { globalThis.fetch = realFetch; });

// ── the driver ───────────────────────────────────────────────────────────────────────────────

describe('postmark driver — the request', () => {
  it('sends the fields Postmark needs, including a text part', async () => {
    stubFetch(200, { MessageID: 'pm-1', ErrorCode: 0 });
    const r = await postmarkDriver.send(message);
    expect(r).toEqual({ messageId: 'pm-1', error: null });

    const body = JSON.parse(String(lastRequest!.init.body));
    // UNQUOTED, and that is correct: the name carries no RFC 5322 special, so quoting it would
    // change the bytes of every message for nothing. (The quoting path has its own test in
    // email-seam.test.ts, against a name with a comma in it.)
    expect(body.From).toBe('Kate Ulepic via RFP Pipeline <notifications@rfppipeline.com>');
    expect(body.ReplyTo).toBe('kate@foundation3dp.test');
    expect(body.MessageStream).toBe('outbound');
    expect(body.TextBody).toBeTruthy();     // no legacy bytes to preserve here, unlike Gmail
    expect(body.Metadata.correlation_id).toBe(message.correlationId);
  });

  it('honours POSTMARK_API_BASE, which is what makes the emulator possible', () => {
    process.env.POSTMARK_API_BASE = 'http://127.0.0.1:8788';
    stubFetch(200, { MessageID: 'pm-2' });
    return postmarkDriver.send(message).then(() => {
      expect(lastRequest!.url).toBe('http://127.0.0.1:8788/email');
    });
  });

  it('trims metadata to Postmark limits instead of letting the provider reject the send', async () => {
    stubFetch(200, { MessageID: 'pm-3' });
    const many = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, 'v'.repeat(200)]));
    await postmarkDriver.send({ ...message, metadata: many });
    const body = JSON.parse(String(lastRequest!.init.body));
    expect(Object.keys(body.Metadata)).toHaveLength(10);
    expect(Object.values(body.Metadata)[0]).toHaveLength(80);
  });

  it('says a missing token is configuration, not a transport failure', async () => {
    delete process.env.POSTMARK_SERVER_TOKEN;
    const r = await postmarkDriver.send(message);
    expect(r.error).toBe('POSTMARK_SERVER_TOKEN is not set');
  });
});

describe('postmark driver — the error translations that save time', () => {
  it('names the account-vs-server token confusion on a 401', async () => {
    // Postmark returns 401 for BOTH a wrong key and the account token used to send. The second is
    // far more common and reads identically, so the message has to say so.
    stubFetch(401, { ErrorCode: 10, Message: 'No Account or Server API tokens were supplied.' });
    const r = await postmarkDriver.send(message);
    expect(r.error).toMatch(/ACCOUNT token rather than the SERVER token/);
  });

  it('reports a 406 as a DIVERGENCE, because our list should have caught it first', async () => {
    stubFetch(406, { ErrorCode: 406, Message: 'inactive recipient' });
    const r = await postmarkDriver.send(message);
    expect(r.error).toMatch(/the two lists have diverged/);
    expect(r.error).toMatch(/a bounce webhook was missed/);
  });

  it('never throws when the network does', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const r = await postmarkDriver.send(message);
    expect(r.messageId).toBeNull();
    expect(r.error).toMatch(/ECONNREFUSED/);
  });
});

// ── the webhook ──────────────────────────────────────────────────────────────────────────────

function hook(body: unknown, opts: { token?: string; basic?: string } = {}) {
  const url = opts.token
    ? `https://app.test/api/webhooks/postmark?token=${encodeURIComponent(opts.token)}`
    : 'https://app.test/api/webhooks/postmark';
  return webhook(new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(opts.basic ? { authorization: `Basic ${Buffer.from(opts.basic).toString('base64')}` } : {}),
    },
    body: JSON.stringify(body),
  }));
}

describe('postmark webhook — authorization', () => {
  it('refuses an unauthenticated call', async () => {
    const res = await hook({ RecordType: 'Delivery' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('refuses the wrong secret', async () => {
    const res = await hook({ RecordType: 'Delivery' }, { token: 'nope' });
    expect(res.status).toBe(401);
  });

  it('accepts the secret as Basic auth — the shape Postmark actually sends', async () => {
    const res = await hook({ RecordType: 'Delivery', MessageID: 'pm-1', Recipient: 'a@b.test' },
      { basic: 'postmark:hook-secret' });
    expect(res.status).toBe(200);
  });

  it('answers 503, not 200, when the secret is unset — so outcomes replay once it is', async () => {
    // A 200 here would tell Postmark the outcome was accepted and it would never be redelivered.
    delete process.env.POSTMARK_WEBHOOK_SECRET;
    const res = await hook({ RecordType: 'Delivery' }, { token: 'anything' });
    expect(res.status).toBe(503);
  });
});

describe('postmark webhook — outcomes', () => {
  it('a delivery emits notification.delivered against the send\'s tenant', async () => {
    ledgerRow.current = {
      id: 'send-1', tenantId: '11111111-1111-4111-8111-111111111111',
      correlationId: '33333333-3333-4333-8333-333333333333', template: 'proposal_ready',
    };
    const res = await hook({ RecordType: 'Delivery', MessageID: 'pm-1', Recipient: 'kate@example.test' },
      { token: 'hook-secret' });
    expect(res.status).toBe(200);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].type).toBe('notification.delivered');
    expect(emitted[0].tenantId).toBe('11111111-1111-4111-8111-111111111111');
    expect(emitted[0].payload).toMatchObject({ resolved: true, template: 'proposal_ready' });
    expect(suppressed).toEqual([]);
  });

  it('a HARD bounce suppresses the address', async () => {
    const res = await hook({
      RecordType: 'Bounce', Type: 'HardBounce', TypeCode: 1,
      MessageID: 'pm-2', Recipient: 'gone@example.test', Description: 'no such user',
    }, { token: 'hook-secret' });
    expect(res.status).toBe(200);
    expect(suppressed).toEqual([{ email: 'gone@example.test', reason: 'hard_bounce', source: 'postmark_webhook', detail: expect.anything() }]);
    expect(emitted[0].payload).toMatchObject({ hard: true, suppressed: true });
  });

  it('a SOFT bounce does NOT suppress — and says so in the payload', async () => {
    // Suppressing on a full mailbox would stop that customer's notifications for good, over a
    // condition that clears by itself. The event records the decision rather than leaving someone
    // to infer it from an absent suppression row.
    const res = await hook({
      RecordType: 'Bounce', Type: 'SoftBounce', TypeCode: 4096,
      MessageID: 'pm-3', Recipient: 'full@example.test',
    }, { token: 'hook-secret' });
    expect(res.status).toBe(200);
    expect(suppressed).toEqual([]);
    expect(emitted[0].type).toBe('notification.bounced');
    expect(emitted[0].payload).toMatchObject({ hard: false, suppressed: false });
  });

  it('a spam complaint suppresses and emits its own type', async () => {
    const res = await hook({ RecordType: 'SpamComplaint', MessageID: 'pm-4', Recipient: 'angry@example.test' },
      { token: 'hook-secret' });
    expect(res.status).toBe(200);
    expect(suppressed[0]).toMatchObject({ email: 'angry@example.test', reason: 'spam_complaint' });
    expect(emitted[0].type).toBe('notification.complained');
  });

  it('records an outcome it cannot attribute rather than dropping it', async () => {
    ledgerRow.current = null;
    const res = await hook({ RecordType: 'Delivery', MessageID: 'unknown', Recipient: 'x@y.test' },
      { token: 'hook-secret' });
    expect(res.status).toBe(200);
    expect(emitted[0].payload).toMatchObject({ resolved: false });
    expect(emitted[0].tenantId).toBeNull();
  });

  it('answers 200 to a record type it ignores, so Postmark stops retrying', async () => {
    const res = await hook({ RecordType: 'Open', MessageID: 'pm-5' }, { token: 'hook-secret' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ data: { handled: null, recordType: 'Open' } });
    expect(emitted).toEqual([]);
  });
});
