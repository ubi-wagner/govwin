/**
 * What `send()` guarantees, independent of any transport.
 *
 * The four things the seam owns — suppression, idempotency, the ledger, sender resolution — are
 * asserted here against a stub driver, because they must hold identically whichever transport is
 * selected. A driver-specific test would prove them for Gmail and say nothing about Postmark.
 *
 * The ordering assertions matter as much as the outcomes. "Reserved before dispatch" is the whole
 * idempotency mechanism; a test that only checks the return value would pass against an
 * implementation that sends first and records afterwards, which double-sends on every replay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` factories are hoisted above every top-level statement, so the doubles they close over
// have to be hoisted too — a plain `const` above them is still in the temporal dead zone when the
// factory runs.
const { driverSend, ledger } = vi.hoisted(() => ({
  driverSend: vi.fn(),
  ledger: {
    suppressionFor: vi.fn(),
    reserve: vi.fn(),
    confirm: vi.fn(),
    recordSuppressed: vi.fn(),
    suppress: vi.fn(),
    normalizeAddress: (e: string) => e.trim().toLowerCase(),
  },
}));

vi.mock('@/lib/email/drivers/gmail', () => ({
  gmailDriver: { name: 'gmail', send: (...a: unknown[]) => driverSend(...a) },
}));
vi.mock('@/lib/email/ledger', () => ledger);

import { send, htmlToText } from '@/lib/email';
import { formatFrom, resolveSender } from '@/lib/email/sender-identity';

/** The order in which the seam touched its collaborators, so sequencing can be asserted. */
let order: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  order = [];
  ledger.suppressionFor.mockImplementation(async () => { order.push('suppression'); return null; });
  ledger.reserve.mockImplementation(async () => { order.push('reserve'); return { ok: true, sendId: 'send-1' }; });
  ledger.confirm.mockImplementation(async () => { order.push('confirm'); });
  ledger.recordSuppressed.mockImplementation(async () => { order.push('recordSuppressed'); return 'send-s'; });
  driverSend.mockImplementation(async () => { order.push('dispatch'); return { messageId: 'mid-1', error: null }; });
});

const base = { to: 'kate@example.test', subject: 'Hello', html: '<p>Hi</p>', kind: 'transactional' as const };

describe('send() — the happy path', () => {
  it('reserves BEFORE it dispatches, and confirms after', async () => {
    const r = await send(base);
    expect(order).toEqual(['suppression', 'reserve', 'dispatch', 'confirm']);
    expect(r.accepted).toBe(true);
    expect(r.messageId).toBe('mid-1');
    expect(r.sendId).toBe('send-1');
  });

  it('mints a correlation id and returns it', async () => {
    const r = await send(base);
    expect(r.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(ledger.reserve.mock.calls[0][0].correlationId).toBe(r.correlationId);
  });

  it('carries the correlation and tenant into provider metadata, where a webhook echoes them back', async () => {
    await send({ ...base, tenantId: '11111111-1111-4111-8111-111111111111', metadata: { proposal_id: 'p1' } });
    const dispatched = driverSend.mock.calls[0][0];
    expect(dispatched.metadata).toMatchObject({
      proposal_id: 'p1',
      tenant_id: '11111111-1111-4111-8111-111111111111',
      correlation_id: dispatched.correlationId,
    });
  });

  it('hands the driver a fully resolved message — no optional fields left for it to guess', async () => {
    await send(base);
    const m = driverSend.mock.calls[0][0];
    expect(m.sender.fromAddress).toBeTruthy();
    expect(m.text.length).toBeGreaterThan(0);
    expect(m.idempotencyKey).toBeTruthy();
    expect(m.tenantId).toBeNull();
    expect(m.tags).toEqual([]);
  });
});

describe('send() — refusals', () => {
  it('rejects a malformed recipient without touching the database', async () => {
    const r = await send({ ...base, to: 'not-an-address' });
    expect(r.accepted).toBe(false);
    expect(r.error).toBe('INVALID_RECIPIENT');
    expect(order).toEqual([]);          // the cheapest check runs first, on purpose
    expect(driverSend).not.toHaveBeenCalled();
  });

  it('suppression is not an error, and still leaves a ledger row', async () => {
    ledger.suppressionFor.mockImplementation(async () => { order.push('suppression'); return 'hard_bounce'; });
    const r = await send(base);
    expect(r.suppressed).toBe(true);
    expect(r.error).toBeNull();         // the system working, not an outage
    expect(r.accepted).toBe(false);
    expect(r.sendId).toBe('send-s');    // the operator can still answer "why did this not go?"
    expect(driverSend).not.toHaveBeenCalled();
    expect(order).toEqual(['suppression', 'recordSuppressed']);
  });

  it('a replayed idempotency key sends nothing and is not reported as a failure', async () => {
    ledger.reserve.mockImplementation(async () => { order.push('reserve'); return { ok: false, reason: 'duplicate' }; });
    const r = await send({ ...base, idempotencyKey: 'event-42' });
    expect(r.duplicate).toBe(true);
    expect(r.error).toBeNull();
    expect(r.accepted).toBe(false);
    expect(driverSend).not.toHaveBeenCalled();
  });

  it('an unreachable ledger stops the send rather than risking a double', async () => {
    ledger.reserve.mockImplementation(async () => ({ ok: false, reason: 'error', error: 'connection refused' }));
    const r = await send(base);
    expect(r.accepted).toBe(false);
    expect(r.error).toMatch(/^LEDGER_UNAVAILABLE/);
    expect(driverSend).not.toHaveBeenCalled();
  });
});

describe('send() — failures close the ledger', () => {
  it('a driver error is recorded as failed, not left pending', async () => {
    driverSend.mockImplementation(async () => ({ messageId: null, error: 'mailbox full' }));
    const r = await send(base);
    expect(r.accepted).toBe(false);
    expect(r.error).toBe('mailbox full');
    expect(ledger.confirm.mock.calls[0][0]).toMatchObject({ sendId: 'send-1', status: 'failed', error: 'mailbox full' });
  });

  it('a driver that THROWS — which the contract forbids — still closes the row', async () => {
    // Without this the reservation stays 'pending' forever and its idempotency key is burned:
    // every retry finds the key taken and refuses, so one bad throw silences that message for good.
    driverSend.mockImplementation(async () => { throw new Error('socket hang up'); });
    const r = await send(base);
    expect(r.accepted).toBe(false);
    expect(ledger.confirm).toHaveBeenCalledTimes(1);
    expect(ledger.confirm.mock.calls[0][0].status).toBe('failed');
  });

  it('never throws, whatever the driver does', async () => {
    driverSend.mockImplementation(async () => { throw new Error('boom'); });
    await expect(send(base)).resolves.toBeTruthy();
  });
});

describe('driver selection', () => {
  it('correspondence is pinned to Gmail and ignores EMAIL_DRIVER', async () => {
    // Postmark cannot do this job: the message would not appear in the sender's Sent folder and
    // its reply would arrive as a webhook rather than in their inbox.
    process.env.EMAIL_DRIVER = 'postmark';
    try {
      const r = await send({ ...base, kind: 'correspondence' });
      expect(r.provider).toBe('gmail');
    } finally { delete process.env.EMAIL_DRIVER; }
  });

  it('an unknown EMAIL_DRIVER falls back rather than dead-ending a notification', async () => {
    process.env.EMAIL_DRIVER = 'carrier-pigeon';
    try {
      const r = await send(base);
      expect(r.provider).toBe('gmail');
      expect(r.accepted).toBe(true);
    } finally { delete process.env.EMAIL_DRIVER; }
  });
});

describe('htmlToText', () => {
  it('keeps the link target — "Click here" with no URL is worse than no text part', () => {
    const text = htmlToText('<p>Reset it: <a href="https://x.test/r?t=abc">Reset Password</a></p>');
    expect(text).toContain('https://x.test/r?t=abc');
    expect(text).toContain('Reset Password');
    expect(text).not.toContain('<a');
  });

  it('drops style and script rather than rendering their contents as prose', () => {
    const text = htmlToText('<style>.a{color:red}</style><script>alert(1)</script><p>Hi</p>');
    expect(text).toBe('Hi');
  });

  it('decodes the entities a template actually produces', () => {
    expect(htmlToText('<p>Tom &amp; Jerry &lt;3</p>')).toBe('Tom & Jerry <3');
  });
});

describe('sender identity', () => {
  it('the default From is unchanged from before the seam existed', () => {
    // The conversion of eleven call sites has to be provably a refactor. A quoted display name is
    // valid RFC 5322 and would still have changed the bytes of every message the platform sends.
    expect(formatFrom(resolveSender())).toBe('RFP Pipeline <platform@rfppipeline.com>');
  });

  it('a tenant persona goes in the display name, never in the envelope', () => {
    const s = resolveSender({ onBehalfOfName: 'Kate Ulepic', replyTo: 'kate@foundation3dp.test' });
    expect(s.fromName).toBe('Kate Ulepic via RFP Pipeline');
    expect(s.fromAddress).toBe('platform@rfppipeline.com');   // SPF/DKIM alignment lives here
    expect(s.replyTo).toBe('kate@foundation3dp.test');
  });

  it('quotes a display name containing RFC 5322 specials', () => {
    const s = resolveSender({ onBehalfOfName: 'Ulepic, Kate' });
    expect(formatFrom(s)).toBe('"Ulepic, Kate via RFP Pipeline" <platform@rfppipeline.com>');
  });
});
