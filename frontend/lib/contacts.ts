/**
 * `contacts` — the subject the CRM never had, and the one writer that maintains it.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────────────────────
 * docs/CRM_ANALYSIS §2: *there is no CRM in the CRM* — 24 tables in `cms-postgres` and not one of
 * them holds a person. What lives there is a competent outbound engine with nothing to aim at.
 * Migration 242 joined the two ends of the funnel; migration 243 added the subject they are all
 * about. This module is the only place that writes it.
 *
 * ── THE INVARIANT ────────────────────────────────────────────────────────────────────────────
 * **Recording a contact must never fail a capture.** Somebody joining the waitlist or submitting
 * an application is the business event; the contact row is our bookkeeping about it. So
 * `recordContact` catches its own errors and returns null — the two callers do nothing different
 * either way, and putting the try/catch here rather than at each call site is what stops the next
 * caller from forgetting it.
 *
 * ── FIRST TOUCH WINS, EVERYWHERE ─────────────────────────────────────────────────────────────
 * `first_seen_at`, `first_session_id` and `source` are never overwritten, and `name`/`company_name`
 * only fill a gap. Somebody who joins the waitlist from one campaign, returns through another and
 * then applies was BROUGHT here once; crediting the last campaign they happened to arrive through
 * is the attribution error most worth avoiding, and it is the one a naive upsert makes silently.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────────────────────
 * `contacts` is PLATFORM scope with no `tenant_id` at all — see migration 243 for why adding one
 * would leak the whole prospect list through the `OR tenant_id IS NULL` arm of
 * `tenant_isolation_select`. Conversion is DERIVED: contacts → applications.contact_id →
 * applications.tenant_id. The table carries no RLS and is protected the way `users` and
 * `applications` are: by the app-layer admin gate.
 */

import { sql, sqlBypass } from '@/lib/db';
import { mailStateFor } from '@/lib/email';

/** How a person entered our world. Free text in the column — this list will grow with the first
 *  campaign that has its own landing page, and a CHECK constraint would make that a migration. */
export type ContactSource = 'waitlist' | 'application' | 'manual' | 'import';

/** Session ids are minted by the browser, so bound them before they reach a text column. */
function cleanSession(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null;
}

/**
 * Upsert the person behind a capture, returning their contact id.
 *
 * Never throws: a failure here is logged and returns null, because the waitlist entry or the
 * application it accompanies is the thing that actually matters to the person submitting it.
 */
export async function recordContact(input: {
  email: string;
  name?: string | null;
  companyName?: string | null;
  sessionId?: string | null;
  source: ContactSource;
}): Promise<string | null> {
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!email) return null;

  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO contacts (email, name, company_name, first_session_id, source)
      VALUES (${email}, ${input.name ?? null}, ${input.companyName ?? null},
              ${cleanSession(input.sessionId)}, ${input.source})
      ON CONFLICT (email) DO UPDATE SET
        -- COALESCE(existing, incoming): a later, richer touch FILLS a gap and never overwrites
        -- what we already knew. first_seen_at, first_session_id and source are first-touch facts.
        name             = COALESCE(contacts.name, EXCLUDED.name),
        company_name     = COALESCE(contacts.company_name, EXCLUDED.company_name),
        first_session_id = COALESCE(contacts.first_session_id, EXCLUDED.first_session_id),
        updated_at       = now()
      RETURNING id
    `;
    return rows[0]?.id ?? null;
  } catch (e) {
    console.error('[contacts] recordContact failed (capture unaffected):', e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The funnel read. Admin cross-tenant aggregate → sqlBypass (`purchases` carries RLS, and this
// deliberately spans every tenant). docs/RLS_CUTOVER.md.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Below this many sessions, a conversion RATE is noise and is not shown — the counts are.
 *
 * A rate computed over three sessions is not a small number, it is an unknown one, and a dashboard
 * that prints it as `0.0%` invents a fact. Same rule as the Projects roll-ups: a measure with no
 * denominator reads "not measured", never a confident zero. The floor is stated on the page, so a
 * blank cell reads as "not enough data yet" rather than as a bug.
 */
export const RATE_FLOOR = 20;

/**
 * A conversion rate as a percentage, or `null` when the denominator is too small to mean anything.
 *
 * The `null` is the whole point and it is easy to "simplify" away: `(0 / 3) * 100` is `0`, and a
 * dashboard cell reading `0.0%` says *we tried and nothing converted* when the truth is *we have
 * not tried enough to know*. Those are opposite conclusions and only one of them is supportable.
 * Same rule as `lib/projects/rollup.ts`: a measure with no denominator is "not measured".
 */
export function conversionRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (denominator < RATE_FLOOR) return null;
  return (numerator / denominator) * 100;
}

export type FunnelBucket = {
  /** utm_source, else the referrer's host, else 'direct'. `null` = no session at all. */
  source: string | null;
  campaign: string | null;
  sessions: number;
  contacts: number;
  applications: number;
  accepted: number;
  customers: number;
  revenueCents: number;
};

export type FunnelTotals = {
  sessions: number;
  contacts: number;
  applications: number;
  accepted: number;
  customers: number;
  revenueCents: number;
  /** How much of the funnel can be attributed at all: contacts carrying a first-touch session. */
  contactsWithSession: number;
  /** Sessions carrying any UTM parameter — 0 means no campaign has ever been tagged. */
  sessionsWithUtm: number;
};

/**
 * The SQL label for a session's origin, shared by every query below so the buckets cannot drift.
 *
 * ⚠️ UTM lives on `page_views`, NOT `visitor_sessions` — the session row carries referrer, geo and
 * device, and the campaign is per page view because a visitor can arrive on one campaign and
 * return on another. A join written against the wrong table fails with 42703; `drive-commercial-
 * path` found exactly that in an earlier draft of the design doc.
 */
const LABELLED_SESSIONS = (days: number) => sqlBypass`
  WITH first_utm AS (
    -- The campaign that BROUGHT them: the FIRST page view of the session carrying a utm_source.
    SELECT DISTINCT ON (session_id) session_id, utm_source, utm_campaign
      FROM page_views
     WHERE utm_source IS NOT NULL AND utm_source <> ''
     ORDER BY session_id, created_at
  )
  SELECT s.session_id,
         COALESCE(
           NULLIF(f.utm_source, ''),
           -- No campaign tag → the referrer's host, minus a leading www.
           NULLIF(regexp_replace(
             COALESCE(substring(s.referrer FROM '^https?://([^/?#]+)'), ''), '^www\\.', ''), ''),
           'direct'
         ) AS source,
         NULLIF(f.utm_campaign, '') AS campaign,
         (f.session_id IS NOT NULL) AS has_utm
    FROM visitor_sessions s
    LEFT JOIN first_utm f ON f.session_id = s.session_id
   WHERE s.created_at >= now() - (${days} * INTERVAL '1 day')
`;

/**
 * One row per (source, campaign), plus one row with `source: null` for everything that carries no
 * session-based attribution at all.
 *
 * That last row is not tidiness — without it the columns do not sum to the totals, and a funnel
 * page whose rows quietly omit the un-attributed majority is the most convincing wrong number this
 * capability could produce. On a box that has never tagged a campaign, that row IS the funnel.
 */
export async function funnelBySource(days = 90): Promise<FunnelBucket[]> {
  // ⚠️ The ROW type is not `FunnelBucket`: `revenue_cents` is `::bigint`, and postgres.js returns
  // int8 as a STRING. Declaring it `number` here would compile — tsc trusts the assertion — and
  // then `revenueCents.toLocaleString()` would run on a string, `> 0` would compare a string to a
  // number, and the value would RENDER, wrongly. That is the half of the sql<T> trap a wrong NAME
  // does not have: a wrong name is `undefined` and throws. The conversion happens below.
  const rows = await sqlBypass<(Omit<FunnelBucket, 'revenueCents'> & { revenueCents: string })[]>`
    WITH labelled AS (${LABELLED_SESSIONS(days)}),
    -- Attribute every downstream stage through the CONTACT's first-touch session, so one person
    -- lands in exactly one bucket however many times they came back.
    c AS (
      SELECT ct.id, l.source, l.campaign
        FROM contacts ct
        LEFT JOIN labelled l ON l.session_id = ct.first_session_id
       WHERE ct.first_seen_at >= now() - (${days} * INTERVAL '1 day')
    ),
    a AS (
      SELECT app.id, app.status, app.tenant_id, c.source, c.campaign
        FROM applications app
        LEFT JOIN c ON c.id = app.contact_id
       WHERE app.created_at >= now() - (${days} * INTERVAL '1 day')
    ),
    rev AS (
      SELECT a.source, a.campaign, COALESCE(SUM(p.amount_cents), 0)::bigint AS cents
        FROM a JOIN purchases p ON p.tenant_id = a.tenant_id
       WHERE a.tenant_id IS NOT NULL
       GROUP BY 1, 2
    ),
    keys AS (
      SELECT source, campaign FROM labelled
      UNION SELECT source, campaign FROM c
      UNION SELECT source, campaign FROM a
    )
    SELECT k.source,
           k.campaign,
           (SELECT COUNT(*)::int FROM labelled l
             WHERE l.source IS NOT DISTINCT FROM k.source
               AND l.campaign IS NOT DISTINCT FROM k.campaign)               AS sessions,
           (SELECT COUNT(*)::int FROM c
             WHERE c.source IS NOT DISTINCT FROM k.source
               AND c.campaign IS NOT DISTINCT FROM k.campaign)               AS contacts,
           (SELECT COUNT(*)::int FROM a
             WHERE a.source IS NOT DISTINCT FROM k.source
               AND a.campaign IS NOT DISTINCT FROM k.campaign)               AS applications,
           (SELECT COUNT(*)::int FROM a
             WHERE a.source IS NOT DISTINCT FROM k.source
               AND a.campaign IS NOT DISTINCT FROM k.campaign
               AND a.status = 'accepted')                                    AS accepted,
           (SELECT COUNT(DISTINCT a.tenant_id)::int FROM a
             WHERE a.source IS NOT DISTINCT FROM k.source
               AND a.campaign IS NOT DISTINCT FROM k.campaign
               AND a.tenant_id IS NOT NULL)                                  AS customers,
           COALESCE((SELECT r.cents FROM rev r
                      WHERE r.source IS NOT DISTINCT FROM k.source
                        AND r.campaign IS NOT DISTINCT FROM k.campaign), 0)::bigint AS revenue_cents
      FROM keys k
     ORDER BY sessions DESC, contacts DESC, k.source NULLS LAST
  `;
  // int8 comes back from postgres.js as a string — the counts are already ::int, the money is not.
  return rows.map((r) => ({ ...r, revenueCents: Number(r.revenueCents) }));
}

/** The same window, un-bucketed, plus the two coverage numbers the rates depend on. */
export async function funnelTotals(days = 90): Promise<FunnelTotals> {
  const [t] = await sqlBypass<{
    sessions: number; contacts: number; applications: number; accepted: number;
    customers: number; revenueCents: string; contactsWithSession: number; sessionsWithUtm: number;
  }[]>`
    WITH labelled AS (${LABELLED_SESSIONS(days)}),
    c AS (SELECT * FROM contacts WHERE first_seen_at >= now() - (${days} * INTERVAL '1 day')),
    a AS (SELECT * FROM applications WHERE created_at >= now() - (${days} * INTERVAL '1 day'))
    SELECT (SELECT COUNT(*)::int FROM labelled)                                    AS sessions,
           (SELECT COUNT(*)::int FROM labelled WHERE has_utm)                      AS sessions_with_utm,
           (SELECT COUNT(*)::int FROM c)                                           AS contacts,
           (SELECT COUNT(*)::int FROM c WHERE first_session_id IS NOT NULL)        AS contacts_with_session,
           (SELECT COUNT(*)::int FROM a)                                           AS applications,
           (SELECT COUNT(*)::int FROM a WHERE status = 'accepted')                 AS accepted,
           (SELECT COUNT(DISTINCT tenant_id)::int FROM a WHERE tenant_id IS NOT NULL) AS customers,
           (SELECT COALESCE(SUM(p.amount_cents), 0)::bigint FROM purchases p
             WHERE p.tenant_id IN (SELECT tenant_id FROM a WHERE tenant_id IS NOT NULL)) AS revenue_cents
  `;
  return { ...t, revenueCents: Number(t.revenueCents) };
}

export type ContactRow = {
  id: string;
  email: string;
  name: string | null;
  companyName: string | null;
  firstSessionId: string | null;
  firstSeenAt: Date;
  source: string | null;
  /** Derived, never stored — see migration 243. */
  tenantId: string | null;
  tenantName: string | null;
  tenantSlug: string | null;
  applicationStatus: string | null;
  emailsSent: number;
  suppressed: boolean;
};

/**
 * The contact list, with conversion DERIVED through applications rather than read off a column.
 *
 * The stored-status version of this — a `contacts.status` that a route keeps in step — is the
 * design docs/MARKETING_SALES_SYSTEM.md Phase 2 originally sketched, and it is wrong for the same
 * reason `tenant_id` here is wrong: two places for one fact drift, and the copy is the one that
 * gets stale. "Did this person convert" has exactly one writer, and it is the accept route.
 */
export async function listContacts(limit = 200): Promise<ContactRow[]> {
  const rows = await sqlBypass<Omit<ContactRow, 'emailsSent' | 'suppressed'>[]>`
    SELECT c.id, c.email, c.name, c.company_name, c.first_session_id, c.first_seen_at, c.source,
           a.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug, a.status AS application_status
      FROM contacts c
      -- The most recent application, when there is one: a person may apply twice and the live
      -- state is the latest decision, not the first.
      LEFT JOIN LATERAL (
        SELECT app.tenant_id, app.status FROM applications app
         WHERE app.contact_id = c.id ORDER BY app.created_at DESC LIMIT 1
      ) a ON true
      LEFT JOIN tenants t ON t.id = a.tenant_id
     ORDER BY c.first_seen_at DESC
     LIMIT ${limit}
  `;
  // Mail state comes through the send seam, never by querying the two ledger tables from here —
  // they are owned by lib/email and denied to the app role (migration 215).
  const mail = await mailStateFor(rows.map((r) => r.email));
  return rows.map((r) => ({
    ...r,
    emailsSent: mail.get(r.email)?.sent ?? 0,
    suppressed: mail.get(r.email)?.suppressed ?? false,
  }));
}
