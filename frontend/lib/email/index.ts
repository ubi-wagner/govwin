/**
 * `send()` — the one seam every outbound message in the platform goes through.
 *
 * Design: docs/EMAIL_INTERFACE_DESIGN.md · as-built: docs/EMAIL_BUILD_LOG.md
 *
 * ── WHAT THE SEAM DOES THAT A DRIVER MUST NOT ───────────────────────────────────────────────
 * Suppression, idempotency, the ledger, and sender resolution happen HERE, once, rather than once
 * per transport. A driver's only job is to hand bytes to a provider and say what happened. That
 * split is what makes adding Postmark additive instead of a second implementation of the same four
 * concerns, each with its own bugs.
 *
 * ── THE ORDER IS THE CONTRACT ───────────────────────────────────────────────────────────────
 *   1. validate the recipient        — before any DB call, so a typo costs nothing
 *   2. resolve sender / text / ids   — a message is never half-specified past this point
 *   3. suppression check             — refused sends still get a ledger row, or the operator
 *                                      question "why did this not go?" is answered by silence
 *   4. RESERVE the ledger row        — before dispatch. This is the whole idempotency mechanism:
 *                                      a replay finds the key taken and sends nothing.
 *   5. dispatch
 *   6. confirm the outcome
 *
 * Step 4 before step 5 is the part that matters. Reversing them — send, then record — means a crash
 * in between re-sends on replay, and a duplicate nudge to a government customer is worse than a
 * missing one.
 *
 * ── NEVER THROWS ────────────────────────────────────────────────────────────────────────────
 * Every failure is a returned `SendResult`. Callers treat mail as best-effort and wrap these calls
 * in try/catch anyway; a seam that throws would make the existing catch blocks the error handling,
 * which is how a failed send becomes a silent one.
 */
import { randomUUID } from 'crypto';
import { gmailDriver } from './drivers/gmail';
import { confirm, recordSuppressed, reserve, suppressionFor } from './ledger';
import { resolveSender } from './sender-identity';
import type { EmailDriver, OutboundMessage, ResolvedMessage, SendResult } from './types';

export type {
  EmailKind, EmailDriver, OutboundMessage, ResolvedMessage, SenderIdentity, SendResult, SendStatus,
} from './types';
export { resolveSender } from './sender-identity';
export { suppress, suppressionFor } from './ledger';

/** Deliberately permissive — the same shape the admin routes already validate with. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Transports, by name. Postmark joins this map in E6; until then `EMAIL_DRIVER=postmark` resolves
 * to nothing and falls back with a loud log rather than dead-ending a notification.
 */
const DRIVERS: Record<string, EmailDriver> = {
  gmail: gmailDriver,
};

/**
 * Which transport carries this message.
 *
 * `correspondence` is pinned to Gmail and is NOT subject to `EMAIL_DRIVER`. A human's mail sent
 * through Postmark never appears in that human's Sent folder and its reply arrives as a webhook
 * instead of in their inbox — no amount of Reply-To configuration fixes that, so it is not a
 * switchable preference.
 */
function driverFor(kind: string): EmailDriver {
  if (kind === 'correspondence') return gmailDriver;
  const requested = process.env.EMAIL_DRIVER || 'gmail';
  const driver = DRIVERS[requested];
  if (driver) return driver;
  console.error(`[email] EMAIL_DRIVER='${requested}' names no registered driver; falling back to `
    + `gmail. Registered: ${Object.keys(DRIVERS).join(', ')}`);
  return gmailDriver;
}

/**
 * A readable plain-text alternative, derived from the HTML.
 *
 * Not a general HTML-to-text converter and not trying to be: these bodies are the platform's own
 * notification templates — headings, paragraphs, one or two links. It keeps the link target, since
 * a text part reading "Click here" with no URL is worse than no text part at all.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
      const text = String(label).replace(/<[^>]+>/g, '').trim();
      return text && text !== href ? `${text} (${href})` : String(href);
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '· ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function refuse(correlationId: string, error: string): SendResult {
  return {
    provider: 'skipped', messageId: null, accepted: false, error,
    suppressed: false, duplicate: false, correlationId, sendId: null,
  };
}

export async function send(message: OutboundMessage): Promise<SendResult> {
  const correlationId = message.correlationId || randomUUID();

  // ── 1 · the recipient, before any database call ───────────────────────────────────────────
  const to = message.to?.trim();
  if (!to || !EMAIL_SHAPE.test(to)) {
    console.error(`[email] refusing to send: '${message.to}' is not an address`);
    return refuse(correlationId, 'INVALID_RECIPIENT');
  }

  // ── 2 · resolve everything optional ───────────────────────────────────────────────────────
  const idempotencyKey = message.idempotencyKey || randomUUID();
  const tenantId = message.tenantId ?? null;
  const template = message.template ?? null;
  const resolved: ResolvedMessage = {
    ...message,
    to,
    sender: message.sender ?? resolveSender(),
    text: message.text ?? htmlToText(message.html),
    correlationId,
    idempotencyKey,
    tenantId,
    template,
    tags: message.tags ?? [],
    // Echoed back on delivery webhooks — this is how a bounce resolves to the workflow step that
    // caused it. Postmark's metadata values must be strings.
    metadata: {
      ...(message.metadata ?? {}),
      correlation_id: correlationId,
      ...(tenantId ? { tenant_id: tenantId } : {}),
    },
  };

  // ── 3 · suppression ───────────────────────────────────────────────────────────────────────
  const suppressedReason = await suppressionFor(to);
  if (suppressedReason) {
    const sendId = await recordSuppressed({
      correlationId, idempotencyKey, tenantId, kind: resolved.kind, toEmail: to,
      subject: resolved.subject, template, reason: suppressedReason, metadata: resolved.metadata,
    });
    return {
      provider: 'skipped', messageId: null, accepted: false, error: null,
      suppressed: true, duplicate: false, correlationId, sendId,
    };
  }

  // ── 4 · reserve, before dispatch ──────────────────────────────────────────────────────────
  const driver = driverFor(resolved.kind);
  const reservation = await reserve({
    correlationId, idempotencyKey, tenantId, provider: driver.name, kind: resolved.kind,
    toEmail: to, subject: resolved.subject, template, metadata: resolved.metadata,
  });
  if (!reservation.ok) {
    if (reservation.reason === 'duplicate') {
      return {
        provider: driver.name, messageId: null, accepted: false, error: null,
        suppressed: false, duplicate: true, correlationId, sendId: null,
      };
    }
    // The ledger is unreachable, so a first send cannot be told from a replay. Refusing is the
    // conservative half of that trade — see the note in ledger.ts.
    return refuse(correlationId, `LEDGER_UNAVAILABLE: ${reservation.error}`);
  }

  // ── 5 · dispatch ──────────────────────────────────────────────────────────────────────────
  let result;
  try {
    result = await driver.send(resolved);
  } catch (err) {
    // A driver is contracted never to throw. If one does, the ledger still has to close.
    result = { messageId: null, error: err instanceof Error ? err.message : String(err) };
    console.error(`[email] driver '${driver.name}' threw, which it must not:`, err);
  }

  // ── 6 · confirm ───────────────────────────────────────────────────────────────────────────
  await confirm({
    sendId: reservation.sendId,
    status: result.error ? 'failed' : 'sent',
    provider: driver.name,
    providerMessageId: result.messageId,
    error: result.error,
  });

  return {
    provider: driver.name,
    messageId: result.messageId,
    accepted: !result.error,
    error: result.error,
    suppressed: false,
    duplicate: false,
    correlationId,
    sendId: reservation.sendId,
  };
}
