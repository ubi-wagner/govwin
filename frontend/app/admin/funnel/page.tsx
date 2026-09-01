import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import {
  funnelBySource, funnelTotals, conversionRate, RATE_FLOOR,
  type FunnelBucket, type FunnelTotals,
} from '@/lib/contacts';

export const dynamic = 'force-dynamic';

/**
 * /admin/funnel — where people come from and how far they get.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────────────────
 * docs/MARKETING_SALES_SYSTEM.md §0: the funnel was complete at both ends and severed in the
 * middle. Analytics knew who looked; `applications` and `tenants` knew who bought; nothing joined
 * them, because at the single moment an anonymous session became a named person we threw the
 * session away. Migrations 242 and 243 closed that. This page is the first thing that READS the
 * repaired chain end to end — content → sessions → contacts → applications → customers → revenue.
 *
 * ── THE RULE THIS PAGE IS BUILT AROUND ───────────────────────────────────────────────────────
 * **A rate with no denominator reads "not measured", never a confident 0%.** A conversion rate
 * computed over three sessions is not a small number, it is an unknown one, and a dashboard that
 * prints `0.0%` invents a fact — the same failure the Projects roll-ups refuse to make. So:
 *
 *   · a rate is shown only where its denominator clears RATE_FLOOR, and the floor is STATED on the
 *     page, so a blank cell reads as "not enough data yet" rather than as a broken query;
 *   · the un-attributed rows are shown as their own bucket rather than dropped, so the columns sum
 *     to the totals — a by-source table that quietly omits the un-attributed majority is the most
 *     convincing wrong number this capability could produce;
 *   · coverage is stated FIRST. On a box where no campaign has ever been tagged, "0 sessions carry
 *     a UTM parameter" is the single most useful fact here, and burying it under a table of zeroes
 *     would let somebody read those zeroes as performance.
 */

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

function Rate({ num, den }: { num: number; den: number }) {
  // `conversionRate` lives in lib/contacts so the null-below-floor rule is unit-tested rather than
  // re-derived here — a second copy is a second place for someone to "simplify" the null away.
  const r = conversionRate(num, den);
  if (r === null) {
    return (
      <span className="text-gray-400" title={`Not measured — needs at least ${RATE_FLOOR} to compute a rate (have ${den})`}>
        not measured
      </span>
    );
  }
  return <span className="tabular-nums text-gray-700">{r.toFixed(1)}%</span>;
}

/**
 * One stage of the funnel: the count, and underneath it the step rate — WITH ITS OWN NUMERATOR.
 *
 * `num` defaults to the count, but the two differ wherever the step is only partly joined, and
 * that difference is the whole reason this takes a separate parameter. Sessions → contacts joins
 * through `first_session_id`, so a contact who arrived by phone is in `n` and cannot be in the
 * rate: dividing the full count by sessions produced "1 contact · 1.9% of sessions" for a person
 * who never had a session. A rate whose numerator is not drawn from its denominator is worse than
 * no rate — it is arithmetically fine and factually meaningless, and nothing on the page says so.
 */
function Stage({
  label, n, num, of, hint,
}: { label: string; n: number; num?: number; of?: number; hint?: string }) {
  return (
    <div className="flex-1 min-w-[9rem] rounded-lg border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
        {n.toLocaleString()}
      </div>
      <div className="mt-1 text-xs text-gray-500">
        {of === undefined ? hint : <>{hint} <Rate num={num ?? n} den={of} /></>}
      </div>
    </div>
  );
}

export default async function AdminFunnelPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role as Role | undefined;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) redirect('/login');

  const sp = await searchParams;
  const days = [30, 90, 365].includes(Number(sp.days)) ? Number(sp.days) : 90;

  let totals: FunnelTotals | null = null;
  let buckets: FunnelBucket[] = [];
  let loadError: string | null = null;
  try {
    [totals, buckets] = await Promise.all([funnelTotals(days), funnelBySource(days)]);
  } catch (e) {
    // Said out loud. A funnel page that renders zeroes when its query failed reads as "no
    // marketing is working", which is the opposite of "we did not measure" (B131).
    console.error('[admin/funnel] query failed:', e);
    loadError = 'The funnel could not be loaded.';
  }

  const attributable = buckets.filter((b) => b.source !== null);
  const unattributed = buckets.find((b) => b.source === null) ?? null;

  return (
    <div className="p-6 max-w-[1500px]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Funnel</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            Sessions → contacts → applications → customers → revenue, by where people came from.
            Rates are shown only where the denominator is at least {RATE_FLOOR}; below that the
            counts stand alone, because a rate computed over a handful of visits is an unknown
            number, not a small one.
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          {[30, 90, 365].map((d) => (
            <Link
              key={d}
              href={`/admin/funnel?days=${d}`}
              className={`rounded border px-2 py-1 ${
                d === days
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              {d === 365 ? '1 year' : `${d} days`}
            </Link>
          ))}
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {loadError}
        </div>
      )}

      {totals && (
        <>
          {/* ── coverage, stated before any number that depends on it ───────────────────────── */}
          <div
            className={`mb-5 rounded-lg border px-4 py-3 text-sm ${
              totals.sessionsWithUtm === 0
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-gray-200 bg-white text-gray-700'
            }`}
            data-testid="funnel-coverage"
          >
            <div className="font-medium">How much of this is measurable</div>
            <ul className="mt-1.5 space-y-1">
              <li>
                <span className="tabular-nums font-medium">{totals.sessionsWithUtm}</span> of{' '}
                <span className="tabular-nums">{totals.sessions}</span> sessions carry a campaign
                tag (<code>utm_source</code>){totals.sessionsWithUtm === 0 && (
                  <> — nothing has been tagged yet, so every visit below reads as its referrer or
                  as direct. Add <code>?utm_source=…&amp;utm_campaign=…</code> to a campaign link
                  and it separates out here from the next visit onward.</>
                )}
              </li>
              <li>
                <span className="tabular-nums font-medium">{totals.contactsWithSession}</span> of{' '}
                <span className="tabular-nums">{totals.contacts}</span> contacts carry a first-touch
                session — the rest cannot be attributed to a source at all, and are counted in the
                un-attributed row rather than spread across the others.
              </li>
            </ul>
          </div>

          {/* ── the stages ─────────────────────────────────────────────────────────────────── */}
          <div className="mb-6 flex flex-wrap gap-3" data-testid="funnel-stages">
            <Stage label="Sessions" n={totals.sessions} hint={`last ${days} days`} />
            {/*
              The rate here is contacts TRACED TO A SESSION over sessions — not the full contact
              count, which includes people who never had one. When those differ the card says so
              underneath, because "1 contact" beside "0.0% of sessions" reads as a contradiction
              until you know that the one contact arrived outside the measured chain.
            */}
            <Stage
              label="Contacts" n={totals.contacts} num={totals.contactsWithSession}
              of={totals.sessions} hint="traced from a session:"
            />
            <Stage label="Applications" n={totals.applications} of={totals.contacts} hint="of contacts:" />
            <Stage label="Accepted" n={totals.accepted} of={totals.applications} hint="of applications:" />
            <Stage label="Customers" n={totals.customers} of={totals.accepted} hint="of accepted:" />
            <div className="flex-1 min-w-[9rem] rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">Revenue</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
                {money(totals.revenueCents)}
              </div>
              {/* "from attributed customers" was wrong: this sums purchases for every customer in
                  the window, attributed or not. The attributed subset is the by-source table. */}
              <div className="mt-1 text-xs text-gray-500">customers in this window</div>
            </div>
          </div>
          {totals.contacts > totals.contactsWithSession && (
            <p className="-mt-3 mb-6 text-xs text-gray-500">
              {totals.contacts - totals.contactsWithSession} of {totals.contacts} contacts arrived
              without a session and are therefore not in the session → contact rate. They are
              counted in the un-attributed row below.
            </p>
          )}
        </>
      )}

      {/* ── by source ─────────────────────────────────────────────────────────────────────── */}
      {!loadError && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Campaign</th>
                <th className="px-3 py-2 font-medium text-right">Sessions</th>
                <th className="px-3 py-2 font-medium text-right">Contacts</th>
                <th className="px-3 py-2 font-medium text-right">Applications</th>
                <th className="px-3 py-2 font-medium text-right">Accepted</th>
                <th className="px-3 py-2 font-medium text-right">Customers</th>
                <th className="px-3 py-2 font-medium text-right">Revenue</th>
                <th className="px-3 py-2 font-medium text-right">Session → contact</th>
              </tr>
            </thead>
            <tbody>
              {attributable.map((b) => (
                <tr
                  key={`${b.source}|${b.campaign ?? ''}`}
                  data-funnel-source={b.source ?? ''}
                  className="border-t border-gray-100 hover:bg-gray-50"
                >
                  <td className="px-3 py-2 font-medium text-gray-900">{b.source}</td>
                  <td className="px-3 py-2 text-gray-600">{b.campaign ?? <span className="text-gray-400">—</span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.sessions}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.contacts}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.applications}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.accepted}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b.customers}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {b.revenueCents > 0 ? money(b.revenueCents) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right"><Rate num={b.contacts} den={b.sessions} /></td>
                </tr>
              ))}

              {/*
                The un-attributed row is not a footnote. Every contact who arrived by phone, at a
                conference, or with the referrer stripped lands here, and on a box that has never
                tagged a campaign that is ALL of them. Dropping it would make the columns above
                stop summing to the totals, silently.
              */}
              {unattributed && (
                <tr className="border-t-2 border-gray-200 bg-gray-50/60" data-funnel-source="">
                  <td className="px-3 py-2 italic text-gray-600" colSpan={2}>
                    No session — arrived by phone, conference, or with the referrer stripped
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-400">—</td>
                  <td className="px-3 py-2 text-right tabular-nums">{unattributed.contacts}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{unattributed.applications}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{unattributed.accepted}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{unattributed.customers}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {unattributed.revenueCents > 0
                      ? money(unattributed.revenueCents)
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-400">—</td>
                </tr>
              )}

              {buckets.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-gray-500">
                    Nothing in the last {days} days.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500">
        People are in <Link href="/admin/contacts" className="text-blue-600 hover:underline">Contacts</Link>;
        raw visits are in <Link href="/admin/analytics" className="text-blue-600 hover:underline">Analytics</Link>.
        Conversion is derived through <code>applications</code>, never stored on a contact — one
        fact, one writer.
      </p>
    </div>
  );
}
