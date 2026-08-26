/**
 * The `email_sends` ledger and the suppression list (migration 215).
 *
 * ── WHY THIS WRITES THROUGH `sqlBypass` ──────────────────────────────────────────────────────
 * A send happens from a request, a cron, a queue worker and a webhook. `app.tenant_id` is reliably
 * set in exactly one of those four, so a ledger whose correctness depended on request context would
 * be wrong three times out of four. Migration 215 gives `email_sends` a SELECT policy and no write
 * policy at all — the ledger is read-only on `govtech_app` on purpose, and this module is the one
 * place that writes it.
 *
 * `email_suppressions` is denied entirely on the app role for the same reason plus a sharper one:
 * the full list is every address that has bounced anywhere on the platform, which is a contact-list
 * leak wearing a deliverability hat.
 *
 * ── WHY A LEDGER FAILURE STOPS THE SEND ──────────────────────────────────────────────────────
 * `reserve()` failing means we cannot tell a first send from a replay. Sending anyway would trade a
 * visible outage for a silent double-send, and a duplicate nudge to a government customer is worse
 * than a missing one. In practice the case barely arises: every caller here already needed the
 * database to decide there was something to say.
 *
 * ⚠️ postgres.js is configured with `transform: { column: { from: postgres.toCamel } }`, so every
 * row comes back camelCased — `provider_message_id` reads as `providerMessageId`. The row types
 * below are declared camelCase to match the runtime. A snake_case declaration compiles (tsc trusts
 * the assertion) and reads `undefined` at run time; that has shipped twice in this repo.
 */
import { sqlBypass } from '@/lib/db';
import type { SendStatus } from './types';

/** What a jsonb column can hold. `Record<string, unknown>` is not assignable to postgres.js's
 *  JSONValue, and widening it with a cast would hide a genuinely unserialisable value. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A reservation outcome. `duplicate` means a row already exists and is pending or done. */
export type Reservation =
  | { ok: true; sendId: string }
  | { ok: false; reason: 'duplicate' }
  | { ok: false; reason: 'error'; error: string };

/**
 * Addresses are compared lower-cased. `email_suppressions.email` carries a
 * `CHECK (email = lower(email))` so a mixed-case row cannot exist to be missed — but the LOOKUP
 * has to normalise too, or the check only protects one side of the comparison.
 */
export function normalizeAddress(email: string): string {
  return email.trim().toLowerCase();
}

/** Is this address suppressed? Returns the reason, or null. Never throws. */
export async function suppressionFor(email: string): Promise<string | null> {
  try {
    const rows = await sqlBypass<{ reason: string }[]>`
      SELECT reason FROM email_suppressions WHERE email = ${normalizeAddress(email)} LIMIT 1`;
    return rows[0]?.reason ?? null;
  } catch (err) {
    // Fail OPEN here, unlike reserve(). A suppression list we cannot read is a deliverability
    // risk; a notification we refuse to send because a read failed is a broken product. The
    // asymmetry is deliberate and the failure is logged rather than swallowed.
    console.error('[email/ledger] suppression lookup failed:', err);
    return null;
  }
}

/**
 * Reserve the send BEFORE dispatch, which is the only shape in which a replay can be refused.
 *
 * A row that already exists and reads `failed` is RECLAIMED by compare-and-swap, so a transient
 * provider outage does not permanently burn its idempotency key. A row reading `pending`, `sent` or
 * `suppressed` is a duplicate: nothing is sent and the caller is told why.
 */
export async function reserve(params: {
  correlationId: string;
  idempotencyKey: string;
  tenantId: string | null;
  provider: string;
  kind: string;
  toEmail: string;
  subject: string;
  template: string | null;
  metadata: Record<string, string>;
}): Promise<Reservation> {
  try {
    const inserted = await sqlBypass<{ id: string }[]>`
      INSERT INTO email_sends
        (correlation_id, idempotency_key, tenant_id, provider, kind, status, to_email, subject,
         template, metadata)
      VALUES
        (${params.correlationId}, ${params.idempotencyKey}, ${params.tenantId}, ${params.provider},
         ${params.kind}, 'pending', ${params.toEmail}, ${params.subject}, ${params.template},
         ${sqlBypass.json(params.metadata)})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id`;
    if (inserted[0]) return { ok: true, sendId: inserted[0].id };

    // The key is taken. Reclaim it only if the prior attempt FAILED — compare-and-swap, so two
    // concurrent retries cannot both win the row.
    const reclaimed = await sqlBypass<{ id: string }[]>`
      UPDATE email_sends
         SET status = 'pending', error = NULL, provider = ${params.provider},
             correlation_id = ${params.correlationId}
       WHERE idempotency_key = ${params.idempotencyKey} AND status = 'failed'
      RETURNING id`;
    if (reclaimed[0]) return { ok: true, sendId: reclaimed[0].id };

    return { ok: false, reason: 'duplicate' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error('[email/ledger] reserve failed:', error);
    return { ok: false, reason: 'error', error };
  }
}

/**
 * Record the outcome against a reserved row.
 *
 * Best-effort by design: the message has already gone, and throwing here would turn a bookkeeping
 * failure into a caller-visible send failure for a send that actually succeeded. The one thing that
 * must not happen is silence, so it logs.
 */
export async function confirm(params: {
  sendId: string;
  status: SendStatus;
  provider: string;
  providerMessageId: string | null;
  error: string | null;
}): Promise<void> {
  try {
    await sqlBypass`
      UPDATE email_sends
         SET status = ${params.status},
             provider = ${params.provider},
             provider_message_id = ${params.providerMessageId},
             error = ${params.error},
             sent_at = ${params.status === 'sent' ? new Date() : null}
       WHERE id = ${params.sendId}`;
  } catch (err) {
    console.error('[email/ledger] confirm failed — the message was sent but the ledger did not '
      + `record it (send ${params.sendId}):`, err);
  }
}

/**
 * Record a send that was refused before dispatch. Reserves and closes in one row so a suppressed
 * address still leaves a trace — the operator question this table exists to answer is "why did this
 * notification not go?", and an absent row answers it with silence.
 */
export async function recordSuppressed(params: {
  correlationId: string;
  idempotencyKey: string;
  tenantId: string | null;
  kind: string;
  toEmail: string;
  subject: string;
  template: string | null;
  reason: string;
  metadata: Record<string, string>;
}): Promise<string | null> {
  try {
    const rows = await sqlBypass<{ id: string }[]>`
      INSERT INTO email_sends
        (correlation_id, idempotency_key, tenant_id, provider, kind, status, to_email, subject,
         template, error, metadata)
      VALUES
        (${params.correlationId}, ${params.idempotencyKey}, ${params.tenantId}, 'skipped',
         ${params.kind}, 'suppressed', ${params.toEmail}, ${params.subject}, ${params.template},
         ${`suppressed: ${params.reason}`}, ${sqlBypass.json(params.metadata)})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id`;
    return rows[0]?.id ?? null;
  } catch (err) {
    console.error('[email/ledger] recordSuppressed failed:', err);
    return null;
  }
}

/** Add an address to the suppression list. Idempotent — a second bounce is not an error. */
export async function suppress(params: {
  email: string;
  reason: 'hard_bounce' | 'spam_complaint' | 'manual';
  source: 'postmark_webhook' | 'operator';
  detail?: { [key: string]: Json };
}): Promise<boolean> {
  try {
    await sqlBypass`
      INSERT INTO email_suppressions (email, reason, source, detail)
      VALUES (${normalizeAddress(params.email)}, ${params.reason}, ${params.source},
              ${sqlBypass.json(params.detail ?? {})})
      ON CONFLICT (email) DO NOTHING`;
    return true;
  } catch (err) {
    console.error('[email/ledger] suppress failed:', err);
    return false;
  }
}
