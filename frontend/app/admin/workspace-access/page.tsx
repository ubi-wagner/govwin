/**
 * /admin/workspace-access — who is inside a customer's workspace, and who has been.
 *
 * ── THE QUESTION THIS ANSWERS ────────────────────────────────────────────────────────────────
 * Two actors enter a company's account without belonging to it: an rfp_admin shadowing, and a
 * partner-manager descending into a client they manage. Every one of those visits is written into
 * that customer's own audit trail — but nothing on the platform side could ask the aggregate
 * question: **is anyone in a customer's account right now, and for how long.**
 *
 * Answering it needed a bracket with an end, which is what `space_presence` (mig 246) added. This
 * page is the reason it is worth having as state rather than only as events.
 *
 * It also gives the sweep a FACE. A bracket that should have closed and did not is otherwise
 * invisible until somebody reads a customer's trail; here it is a row with an obviously wrong
 * duration, sorted to the top.
 *
 * ── NO CLOCK DURING RENDER ───────────────────────────────────────────────────────────────────
 * Durations are computed on the SERVER against one timestamp taken once, and the "as of" stamp is
 * rendered as a fixed UTC string. A `'use client'` component that reads `Date.now()` while
 * rendering makes its output a function of when it rendered: the server writes one value, the
 * client hydrates a beat later and writes another, React throws #418, and hydration fails for the
 * whole subtree while the route still answers HTTP 200 — so nothing gating on a status code can
 * see it. Eight occurrences in this repo. This page is a server component and stays one.
 */
import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import {
  openPresences, recentPresences, REASON_COPY, minutesBetween, humanDuration,
} from '@/lib/space-presence-oversight';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Workspace Access' };

const KIND_COPY: Record<string, string> = {
  shadow: 'RFP administrator',
  partner: 'Partner manager',
};

/** The idle floor the sweep uses. A bracket past it that is still open means the sweep is not running. */
const SWEEP_IDLE_MINUTES = 45;

export default async function WorkspaceAccessPage() {
  const session = await auth();
  const su = session?.user as { role?: unknown } | undefined;
  const role: Role | null = isRole(su?.role) ? su.role : null;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) redirect('/');

  const [open, recent] = await Promise.all([openPresences(), recentPresences(50)]);
  // ONE timestamp for every duration on the page, taken once on the server. Two reads of the clock
  // would make two rows disagree about "now" for no reason a reader could explain.
  const now = new Date();

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold text-gray-900">Workspace access</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">
        Everyone from outside a company who is currently inside its workspace — RFP administrators
        shadowing, and partner managers working in a client&rsquo;s account. Each visit is also
        written to that company&rsquo;s own activity feed; this is the same record, read across all
        of them.
      </p>
      <p className="mt-1 text-xs text-gray-400">As of {now.toISOString().replace('T', ' ').slice(0, 16)} UTC</p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
          In a workspace now — {open.length}
        </h2>
        {open.length === 0 ? (
          <p className="mt-3 rounded-lg border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
            Nobody from outside is in a customer workspace right now.
          </p>
        ) : (
          /* overflow-x-AUTO, never overflow-hidden. Eight admin tables once shared one
             `rounded-lg overflow-hidden` wrapper whose clip was there for the corners, and it made
             63% of every row unreachable at 390px — the body never scrolled sideways precisely
             BECAUSE the content was unreachable. */
          <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">As</th>
                  <th className="px-4 py-3 font-medium">In for</th>
                  <th className="px-4 py-3 font-medium">Last seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {open.map((p) => {
                  const idle = minutesBetween(p.lastSeenAt, now);
                  // Past the sweep's floor and still open ⇒ the sweep is not reaching this row.
                  // Flagged rather than left to look like a very long visit, because the two need
                  // completely different responses.
                  const stuck = idle !== null && idle > SWEEP_IDLE_MINUTES;
                  return (
                    <tr key={p.id} className={stuck ? 'bg-amber-50' : undefined}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{p.tenantName}</td>
                      <td className="px-4 py-2.5 text-gray-700">{p.actorEmail ?? p.actorName ?? '—'}</td>
                      <td className="px-4 py-2.5 text-gray-600">{KIND_COPY[p.kind] ?? p.kind}</td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-700">
                        {humanDuration(minutesBetween(p.enteredAt, now))}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-gray-600">
                        {humanDuration(idle)} ago
                        {stuck && (
                          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-800">
                            past the {SWEEP_IDLE_MINUTES}m idle floor — is the sweep running?
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Recently closed</h2>
        <p className="mt-1 text-xs text-gray-500">
          How each visit ended. &ldquo;Timed out&rdquo; is the only one that is an inference rather
          than a recorded act — it means we stopped seeing them, not that they left at that moment.
        </p>
        {recent.length === 0 ? (
          <p className="mt-3 rounded-lg border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
            No closed visits recorded yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Who</th>
                  <th className="px-4 py-3 font-medium">As</th>
                  <th className="px-4 py-3 font-medium">Stayed</th>
                  <th className="px-4 py-3 font-medium">Ended</th>
                  <th className="px-4 py-3 font-medium">How it ended</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recent.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{p.tenantName}</td>
                    <td className="px-4 py-2.5 text-gray-700">{p.actorEmail ?? p.actorName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-gray-600">{KIND_COPY[p.kind] ?? p.kind}</td>
                    <td className="px-4 py-2.5 tabular-nums text-gray-700">
                      {humanDuration(minutesBetween(p.enteredAt, p.closedAt))}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-gray-600">
                      {p.closedAt instanceof Date ? p.closedAt.toISOString().replace('T', ' ').slice(0, 16) : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {/* The written sentence, never the raw enum. `left_space` is a database value;
                          a term from the system's own vocabulary on a screen is B136, and this
                          console is still read by people. */}
                      {p.closeReason ? REASON_COPY[p.closeReason] ?? p.closeReason : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
