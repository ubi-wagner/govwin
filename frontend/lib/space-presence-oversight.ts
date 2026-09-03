/**
 * WHO IS INSIDE A CUSTOMER'S WORKSPACE — the read side of the presence bracket.
 *
 * ── WHY THIS SURFACE EXISTS ──────────────────────────────────────────────────────────────────
 * `space_presence` (mig 246) was built so a customer's audit trail could answer *"are they still
 * here"* rather than only *"did somebody come in"*. That same row answers a question nobody on the
 * platform side could ask at all: **is anyone in a customer's account right now, and for how long.**
 *
 * Before this, the only way to find out was to read a customer's activity feed one tenant at a
 * time, or to infer it from a log line. Both are the kind of answer nobody goes looking for, which
 * means an administrator sitting in a company's workspace for three days was not visible to anyone.
 *
 * It also gives the SWEEP a face. A bracket that should have closed and did not is otherwise
 * invisible until somebody reads a trail; here it is a row with an obviously wrong duration.
 *
 * ── CROSS-TENANT BY CONSTRUCTION ─────────────────────────────────────────────────────────────
 * The question spans every tenant, so this reads on the owner pool via `sqlBypass` — one of the
 * legitimate cross-tenant admin reads (docs/RLS_CUTOVER.md). The page that renders it is
 * rfp_admin-gated; RLS is not what protects this, the route gate is, and that is stated rather
 * than assumed.
 */
import { sqlBypass } from '@/lib/db';

export interface PresenceRow {
  id: string;
  kind: 'shadow' | 'partner';
  actorEmail: string | null;
  actorName: string | null;
  tenantName: string;
  tenantSlug: string;
  enteredAt: Date;
  lastSeenAt: Date;
  closedAt: Date | null;
  closeReason: string | null;
}

/**
 * What a person reading this actually needs, in the words they would use.
 *
 * The vocabulary is deliberately NOT the column value: `left_space` is a database enum, and a term
 * from the system's own vocabulary shown on a screen is the defect this repo keeps finding (B136,
 * and 48 atoms titled `bulleted_list`). This surface is operator-facing, which makes it milder —
 * but the fix costs one map, and an operator console is still read by people.
 */
export const REASON_COPY: Record<string, string> = {
  explicit: 'Pressed exit',
  left_space: 'Returned to the console',
  moved: 'Moved to another company',
  signed_out: 'Signed out',
  timeout: 'Timed out — never seen again',
};

// The column list is written out TWICE on purpose. Hoisting it into a constant needs
// `sqlBypass.unsafe(...)` to splice it in, and `lib/db.ts`'s clients are Proxies that route only
// the tagged-template CALL — `.unsafe` goes somewhere else, and it is an injection surface for a
// saving of nine lines. Two literal lists cannot drift into a security question.

/** Everyone currently inside a customer's workspace — longest-standing first, which is the risk order. */
export async function openPresences(): Promise<PresenceRow[]> {
  try {
    return (await sqlBypass<PresenceRow[]>`
      SELECT p.id, p.kind,
             u.email AS "actorEmail", u.name AS "actorName",
             t.name AS "tenantName", t.slug AS "tenantSlug",
             p.entered_at AS "enteredAt", p.last_seen_at AS "lastSeenAt",
             p.closed_at AS "closedAt", p.close_reason AS "closeReason"
      FROM space_presence p
      JOIN users u ON u.id = p.user_id
      JOIN tenants t ON t.id = p.tenant_id
      WHERE p.closed_at IS NULL
      ORDER BY p.entered_at ASC`) as unknown as PresenceRow[];
  } catch (e) {
    console.error('[presence-oversight] openPresences failed:', e);
    return [];
  }
}

/** The recent record, so a reader can see the pattern rather than one instant. */
export async function recentPresences(limit = 50): Promise<PresenceRow[]> {
  try {
    return (await sqlBypass<PresenceRow[]>`
      SELECT p.id, p.kind,
             u.email AS "actorEmail", u.name AS "actorName",
             t.name AS "tenantName", t.slug AS "tenantSlug",
             p.entered_at AS "enteredAt", p.last_seen_at AS "lastSeenAt",
             p.closed_at AS "closedAt", p.close_reason AS "closeReason"
      FROM space_presence p
      JOIN users u ON u.id = p.user_id
      JOIN tenants t ON t.id = p.tenant_id
      WHERE p.closed_at IS NOT NULL
      ORDER BY p.closed_at DESC
      LIMIT ${limit}`) as unknown as PresenceRow[];
  } catch (e) {
    console.error('[presence-oversight] recentPresences failed:', e);
    return [];
  }
}

/**
 * Duration in whole minutes between two instants.
 *
 * Both arguments are `timestamptz`, which postgres.js hands back as a JavaScript **Date**, not a
 * string — the #2 crash class in this repo. `.getTime()` on a Date is safe; slicing its string form
 * yields `"Tue Apr 28"` and every arithmetic on it is NaN, which then RENDERS (a milestone once
 * shipped reading `NaN days early`). Returns null rather than a number when either side is missing,
 * so a caller shows "—" instead of a confident zero.
 */
export function minutesBetween(a: Date | null, b: Date | null): number | null {
  if (!(a instanceof Date) || !(b instanceof Date)) return null;
  const ms = b.getTime() - a.getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.round(ms / 60000));
}

/** "3d 4h" · "2h 15m" · "8m" — a duration a person reads, not a raw minute count. */
export function humanDuration(mins: number | null): string {
  if (mins === null) return '—';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}
