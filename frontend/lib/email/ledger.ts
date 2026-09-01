/**
 * The `email_send_ledger` table and the suppression list (migration 215).
 *
 * ── WHY THIS WRITES THROUGH `sqlBypass` ──────────────────────────────────────────────────────
 * A send happens from a request, a cron, a queue worker and a webhook. `app.tenant_id` is reliably
 * set in exactly one of those four, so a ledger whose correctness depended on request context would
 * be wrong three times out of four. Migration 215 gives `email_send_ledger` a SELECT policy and no write
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
      INSERT INTO email_send_ledger
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
      UPDATE email_send_ledger
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
      UPDATE email_send_ledger
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
      INSERT INTO email_send_ledger
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

/** A ledger row, as much of it as an outcome consumer needs. */
export interface LedgerSend {
  id: string;
  tenantId: string | null;
  correlationId: string;
  template: string | null;
}

/**
 * Find the send an inbound delivery outcome belongs to.
 *
 * The provider's Message-ID is the primary key here because it is what a future inbound REPLY's
 * `In-Reply-To` header will also carry — the same lookup serves both, which is the whole reason
 * that column exists. The correlation echo is the fallback for an outcome reported without one.
 *
 * Lives in this module rather than in the webhook route because the ledger is written and read in
 * one place; `__tests__/email-transport-boundary.test.ts` enforces that, and the route would
 * otherwise need the owner connection of its own.
 */
export async function findSend(params: {
  providerMessageId: string | null;
  correlationId: string | null;
}): Promise<LedgerSend | null> {
  if (!params.providerMessageId && !params.correlationId) return null;
  try {
    const rows = await sqlBypass<LedgerSend[]>`
      SELECT id, tenant_id, correlation_id, template
        FROM email_send_ledger
       WHERE (${params.providerMessageId}::text IS NOT NULL
              AND provider_message_id = ${params.providerMessageId})
          OR (${params.correlationId}::text IS NOT NULL
              AND correlation_id = ${params.correlationId}::uuid)
       ORDER BY created_at DESC
       LIMIT 1`;
    return rows[0] ?? null;
  } catch (err) {
    // An outcome we cannot attribute is still worth recording. Losing it because a lookup failed
    // would be worse than an event carrying a null tenant.
    console.error('[email/ledger] findSend failed:', err);
    return null;
  }
}

/**
 * The recent send history, and the 30-day totals — for the operator console.
 *
 * ── WHY THESE LIVE HERE AND NOT IN THE PAGE ─────────────────────────────────────────────────
 * `__tests__/email-transport-boundary.test.ts` enforces that only `lib/email` touches the ledger
 * tables, and it caught the first version of the console doing exactly that. The rule is not
 * bureaucratic: the ledger is denied to the application role by RLS (migration 215), so a query
 * written anywhere else compiles, ships, and fails at run time in front of whoever opened the page.
 * Reading through this module means the owner connection is used once, in the place that owns it.
 */
export interface LedgerRow {
  id: string;
  toEmail: string;
  subject: string | null;
  template: string | null;
  kind: string;
  status: string;
  provider: string;
  error: string | null;
  tenantSlug: string | null;
  createdAt: Date;
  sentAt: Date | null;
}

export async function recentSends(limit = 100): Promise<LedgerRow[]> {
  try {
    return await sqlBypass<LedgerRow[]>`
      SELECT l.id, l.to_email, l.subject, l.template, l.kind, l.status, l.provider, l.error,
             t.slug AS tenant_slug, l.created_at, l.sent_at
        FROM email_send_ledger l
        LEFT JOIN tenants t ON t.id = l.tenant_id
       ORDER BY l.created_at DESC
       LIMIT ${limit}`;
  } catch (err) {
    console.error('[email/ledger] recentSends failed:', err);
    return [];
  }
}

/** Sends by status over a trailing window. Empty on failure — the caller says so on the page. */
export async function sendTotals(days = 30): Promise<{ status: string; n: number }[]> {
  try {
    return await sqlBypass<{ status: string; n: number }[]>`
      SELECT status, count(*)::int AS n
        FROM email_send_ledger
       WHERE created_at > now() - (${days} || ' days')::interval
       GROUP BY status ORDER BY 2 DESC`;
  } catch (err) {
    console.error('[email/ledger] sendTotals failed:', err);
    return [];
  }
}

/**
 * Lift a suppression — let an address receive mail again.
 *
 * ── THERE WAS NO WAY OUT ────────────────────────────────────────────────────────────────────
 * `suppress` existed and nothing undid it, in code or in any UI. So one hard bounce or one spam
 * complaint stopped a customer's mail permanently: a mailbox that was full on Tuesday, an address
 * that was mistyped once and then corrected, a colleague who hit "spam" on a notification — any of
 * those and that person silently receives nothing, for good, with no page that even shows the
 * state, let alone changes it.
 *
 * That is the worst shape a guard can have. Suppression is CORRECT — mailing a dead address damages
 * the sending domain's reputation for every other customer — but a correct guard with no release is
 * a trap, and the person it traps cannot see it happening.
 *
 * Returns whether a row was actually removed, so a caller can tell "lifted" from "was not
 * suppressed" rather than reporting success either way.
 */
export async function lift(email: string): Promise<boolean> {
  try {
    const rows = await sqlBypass<{ email: string }[]>`
      DELETE FROM email_suppressions
       WHERE email = ${normalizeAddress(email)}
      RETURNING email`;
    return rows.length > 0;
  } catch (err) {
    console.error('[email/ledger] lift failed:', err);
    return false;
  }
}

/** Every suppressed address, newest first — the operator's view of who cannot be reached. */
export interface Suppression {
  email: string;
  reason: string;
  source: string;
  detail: Record<string, unknown> | null;
  createdAt: Date;
}

export async function listSuppressions(limit = 200): Promise<Suppression[]> {
  try {
    return await sqlBypass<Suppression[]>`
      SELECT email, reason, source, detail, created_at
        FROM email_suppressions
       ORDER BY created_at DESC
       LIMIT ${limit}`;
  } catch (err) {
    console.error('[email/ledger] listSuppressions failed:', err);
    return [];
  }
}

/** What we have sent one person, and whether we can still reach them. */
export interface AddressMailState {
  sent: number;
  suppressed: boolean;
}

/**
 * Mail state for a batch of addresses — the contact list's "have we written to them" column.
 *
 * This lives here rather than in `lib/contacts.ts` because the boundary test means it: the two
 * ledger tables are queried in exactly one directory, and a consumer that needs a number out of
 * them asks for the number, not for the table. (Migration 215 also denies both tables to the app
 * role, so a query written elsewhere fails at run time in whatever request reached it.)
 *
 * Batched deliberately: the same fact per contact, fetched per contact, is 200 round trips for a
 * page that renders one table.
 */
export async function mailStateFor(emails: string[]): Promise<Map<string, AddressMailState>> {
  const wanted = [...new Set(emails.map(normalizeAddress).filter(Boolean))];
  const out = new Map<string, AddressMailState>();
  if (wanted.length === 0) return out;
  try {
    const rows = await sqlBypass<{ email: string; sent: number; suppressed: boolean }[]>`
      SELECT a.email,
             (SELECT COUNT(*)::int FROM email_send_ledger e
               WHERE LOWER(e.to_email) = a.email)                          AS sent,
             EXISTS (SELECT 1 FROM email_suppressions s WHERE s.email = a.email) AS suppressed
        FROM UNNEST(${wanted}::text[]) AS a(email)`;
    for (const r of rows) out.set(r.email, { sent: r.sent, suppressed: r.suppressed });
  } catch (err) {
    console.error('[email/ledger] mailStateFor failed:', err);
  }
  return out;
}

/** What was sent in a time window — the observation window's mail panel (lib/observe.ts).
 *
 *  Here rather than there because the boundary test means it: the two ledger tables are queried in
 *  exactly one directory. `/admin/observe` needs the rows; it asks for the rows, not the table.
 *  Migration 215 also denies both tables to the app role, so a query written elsewhere fails at run
 *  time in whatever request reached it — which during a live drive is the worst possible moment. */
export async function sendsSince(since: Date, limit = 100): Promise<Array<{
  toEmail: string; template: string | null; status: string; createdAt: Date;
}>> {
  try {
    return await sqlBypass`
      SELECT to_email, template, status, created_at
        FROM email_send_ledger WHERE created_at >= ${since}
       ORDER BY created_at DESC LIMIT ${limit}`;
  } catch (err) {
    console.error('[email/ledger] sendsSince failed:', err);
    return [];
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
