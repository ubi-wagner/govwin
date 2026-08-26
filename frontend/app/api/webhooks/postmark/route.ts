/**
 * POST /api/webhooks/postmark — delivery outcomes from the provider.
 *
 * This is what turns "we sent it" into "it landed". The send ledger records that a message was
 * handed over; only the provider knows whether a mailbox accepted it, and the answer arrives here
 * minutes later on a separate connection.
 *
 * ── AUTHORIZATION: A SHARED SECRET, NOT A SIGNATURE ──────────────────────────────────────────
 * **Postmark does not sign its webhooks.** There is no HMAC header to verify — the documented
 * mechanism is HTTP Basic auth on the webhook URL, or a secret embedded in the URL, over TLS. So
 * this route accepts `POSTMARK_WEBHOOK_SECRET` presented either as the Basic password or as
 * `?token=`, compared in constant time.
 *
 * Building an HMAC check anyway would look more secure and be strictly worse: it would exercise a
 * verification path that can never run against the real provider, which is the most expensive kind
 * of green.
 *
 * ── WHY IT ANSWERS 200 TO THINGS IT IGNORES ──────────────────────────────────────────────────
 * Postmark RETRIES on a non-2xx. A record type we do not handle is not a failure, and answering 4xx
 * would make the provider redeliver it on a schedule forever. The distinction that matters is
 * between "I could not authenticate you" (401, and Postmark should stop) and "understood, nothing
 * to do" (200).
 *
 * ── WHY IT RUNS ON THE OWNER POOL ────────────────────────────────────────────────────────────
 * There is no session and no tenant context — the request arrives from outside. The shared secret
 * IS the authorization, exactly as the Stripe webhook's signature is. Migration 215 denies ledger
 * writes on the application role, so the update runs through the seam's ledger module, which owns
 * that connection.
 */
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { emitEventSingle, systemActor } from '@/lib/events';
import { findSend, suppress, type LedgerSend } from '@/lib/email';

/** Constant-time compare that does not leak length through an early return. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Still burn a comparison so the timing does not distinguish "wrong length" from "wrong value".
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** The secret, from Basic auth or `?token=` — the two shapes Postmark can actually produce. */
function presentedSecret(request: Request): string | null {
  const url = new URL(request.url);
  const q = url.searchParams.get('token');
  if (q) return q;

  const auth = request.headers.get('authorization') ?? '';
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      return idx >= 0 ? decoded.slice(idx + 1) : decoded;
    } catch { return null; }
  }
  return null;
}

interface PostmarkWebhook {
  RecordType?: string;
  MessageID?: string;
  Recipient?: string;
  Email?: string;
  Type?: string;
  TypeCode?: number;
  Description?: string;
  Details?: string;
  Metadata?: Record<string, string>;
  Tag?: string;
  MessageStream?: string;
}

/**
 * Postmark bounce types that mean the address is DEAD. A soft bounce (mailbox full, server
 * temporarily down) must not suppress: the address is fine and will accept mail tomorrow, and
 * suppressing on one would silently stop that customer's notifications for good.
 */
const HARD_BOUNCE_TYPES = new Set(['HardBounce', 'BadEmailAddress', 'ManuallyDeactivated', 'Unsubscribe', 'SpamNotification']);

export async function POST(request: Request) {
  const expected = process.env.POSTMARK_WEBHOOK_SECRET;
  if (!expected) {
    // A deployment gap, not a fault. 503 keeps Postmark retrying, so the outcomes replay once the
    // secret is set rather than being lost to a 200 — the same reasoning the Stripe webhook uses.
    console.error('[webhooks/postmark] POSTMARK_WEBHOOK_SECRET is not configured');
    return NextResponse.json(
      { error: 'Webhook secret not configured', code: 'POSTMARK_NOT_CONFIGURED' },
      { status: 503 },
    );
  }

  const provided = presentedSecret(request);
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: 'Unauthorized', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  let body: PostmarkWebhook;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const recordType = String(body.RecordType ?? '');
  const messageId = body.MessageID ? String(body.MessageID) : null;
  const recipient = String(body.Recipient ?? body.Email ?? '');
  const correlationFromMetadata = body.Metadata?.correlation_id ?? null;

  // Resolve the send this outcome belongs to. The lookup lives in the ledger module, not here:
  // the ledger is read and written in exactly one place, and the boundary test enforces it.
  const send: LedgerSend | null = await findSend({
    providerMessageId: messageId,
    correlationId: correlationFromMetadata,
  });

  const base = {
    recipientEmail: recipient,
    providerMessageId: messageId,
    correlationId: send?.correlationId ?? correlationFromMetadata,
    template: send?.template ?? null,
    sendId: send?.id ?? null,
    resolved: Boolean(send),
    tag: body.Tag ?? null,
    stream: body.MessageStream ?? null,
  };

  try {
    if (recordType === 'Delivery') {
      await emitEventSingle({
        namespace: 'system',
        type: 'notification.delivered',
        actor: systemActor('postmark-webhook'),
        tenantId: send?.tenantId ?? null,
        payload: { ...base, status: 'sent', details: body.Details ?? null },
      });
      return NextResponse.json({ data: { handled: 'Delivery', resolved: base.resolved } });
    }

    if (recordType === 'Bounce') {
      const bounceType = String(body.Type ?? '');
      const hard = HARD_BOUNCE_TYPES.has(bounceType);
      if (hard && recipient) {
        await suppress({
          email: recipient,
          reason: 'hard_bounce',
          source: 'postmark_webhook',
          detail: { type: bounceType, typeCode: body.TypeCode ?? null, description: body.Description ?? null },
        });
      }
      await emitEventSingle({
        namespace: 'system',
        type: 'notification.bounced',
        actor: systemActor('postmark-webhook'),
        tenantId: send?.tenantId ?? null,
        payload: {
          ...base, status: 'failed', bounceType, hard,
          // A soft bounce is explicitly recorded as NOT suppressing, so the audit trail shows the
          // decision rather than leaving someone to infer it from an absent suppression row.
          suppressed: hard,
          description: body.Description ?? null,
        },
      });
      return NextResponse.json({ data: { handled: 'Bounce', hard, resolved: base.resolved } });
    }

    if (recordType === 'SpamComplaint') {
      if (recipient) {
        await suppress({
          email: recipient,
          reason: 'spam_complaint',
          source: 'postmark_webhook',
          detail: { type: String(body.Type ?? 'SpamComplaint'), typeCode: body.TypeCode ?? null },
        });
      }
      await emitEventSingle({
        namespace: 'system',
        type: 'notification.complained',
        actor: systemActor('postmark-webhook'),
        tenantId: send?.tenantId ?? null,
        payload: { ...base, status: 'failed', suppressed: true },
      });
      return NextResponse.json({ data: { handled: 'SpamComplaint', resolved: base.resolved } });
    }
  } catch (err) {
    console.error(`[webhooks/postmark] failed handling ${recordType}:`, err);
    // 500 so Postmark retries — this one IS a fault, and the outcome is worth redelivering.
    return NextResponse.json({ error: 'Failed to record outcome', code: 'DB_ERROR' }, { status: 500 });
  }

  // Understood, nothing to do. 200 so the provider stops rather than redelivering forever.
  return NextResponse.json({ data: { handled: null, recordType: recordType || null } });
}
