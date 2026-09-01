import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import { listContacts, type ContactRow } from '@/lib/contacts';

export const dynamic = 'force-dynamic';

/**
 * /admin/contacts — the people, whether or not they ever became customers.
 *
 * ── WHY THIS PAGE DID NOT EXIST ──────────────────────────────────────────────────────────────
 * docs/CRM_ANALYSIS §2: *there is no CRM in the CRM*. The outbound engine could compose, queue,
 * sequence and send — and there was no list to send to, because nothing anywhere held a person.
 * A send went to an address somebody typed. Migration 243 added the subject; this is its surface.
 *
 * ── EVERY DERIVED COLUMN IS DERIVED HERE, NOT STORED ─────────────────────────────────────────
 * "Became a customer" comes through `applications.contact_id → applications.tenant_id`, and mail
 * state comes through the send seam. Neither is a column on `contacts`, and that is deliberate:
 * a stored copy of a fact another table owns is the copy that goes stale, and nothing on the page
 * would show it had (docs/MARKETING_SALES_SYSTEM.md §2 — one system of record per capability).
 *
 * Read-only, for the same reason /admin/projects is: the way an admin acts on a customer is to
 * descend into their tenant. What this page is FOR is the question the outbound engine could never
 * answer — who is there, where did they come from, and have we written to them.
 */

function Cell({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <td className={`px-3 py-2 ${muted ? 'text-gray-400' : 'text-gray-700'}`}>{children}</td>;
}

/** A server component, so a UTC stamp is deterministic — no clock read during render (B78/B79). */
const day = (d: Date) => new Date(d).toISOString().slice(0, 10);

export default async function AdminContactsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role as Role | undefined;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) redirect('/login');

  let rows: ContactRow[] = [];
  let loadError: string | null = null;
  try {
    rows = await listContacts(500);
  } catch (e) {
    console.error('[admin/contacts] list failed:', e);
    loadError = 'The contact list could not be loaded.';
  }

  const customers = rows.filter((r) => r.tenantId).length;
  const applied = rows.filter((r) => r.applicationStatus).length;
  const reachable = rows.filter((r) => !r.suppressed).length;

  return (
    <div className="p-6 max-w-[1500px]">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Contacts</h1>
        <p className="mt-1 max-w-3xl text-sm text-gray-500">
          Everyone who has raised a hand — {rows.length.toLocaleString()} {rows.length === 1 ? 'person' : 'people'},
          {' '}{applied} applied, {customers} {customers === 1 ? 'became a customer' : 'became customers'},
          {' '}{reachable} reachable by mail.
          Staff and invited teammates are deliberately absent: they are users, not leads, and
          counting them here would put a denominator under every conversion rate that is mostly
          us (migration 243).
        </p>
      </div>

      {loadError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {loadError}
        </div>
      )}

      {!loadError && rows.length === 0 && (
        <div className="rounded border border-gray-200 bg-white p-6 text-sm text-gray-500">
          No contacts yet. One is created the moment somebody joins the waitlist or submits an
          application.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">First seen</th>
                <th className="px-3 py-2 font-medium">Entered via</th>
                <th className="px-3 py-2 font-medium">Attributed</th>
                <th className="px-3 py-2 font-medium">Application</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium text-right">Mailed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-contact-id={r.id} className="border-t border-gray-100 align-top hover:bg-gray-50">
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900">{r.name ?? r.email}</div>
                    {r.name && <div className="text-xs text-gray-500">{r.email}</div>}
                  </td>
                  <Cell muted={!r.companyName}>{r.companyName ?? '—'}</Cell>
                  <Cell>{day(r.firstSeenAt)}</Cell>
                  <Cell muted={!r.source}>{r.source ?? '—'}</Cell>
                  {/*
                    "Attributed" is whether we can say where they came from AT ALL, and it must
                    stay visibly distinct from "came from nowhere". A dash here means the funnel
                    cannot place this person; showing 'direct' instead would be a fabricated
                    source, which is the one thing this chain is built not to do.
                  */}
                  <Cell muted={!r.firstSessionId}>
                    {r.firstSessionId
                      ? <span className="text-green-700">session recorded</span>
                      : 'no session'}
                  </Cell>
                  <Cell muted={!r.applicationStatus}>{r.applicationStatus ?? '—'}</Cell>
                  <td className="px-3 py-2">
                    {r.tenantId && r.tenantSlug ? (
                      // A plain anchor, NOT next/link: `/api/enter` is a route handler, not a
                      // page, so Link prefetches an RSC payload that does not exist and logs
                      // "Failed to fetch RSC payload" on every render — which is a console throw
                      // the surfaces lens fails the page on, correctly. The parameter is `slug`;
                      // `?tenant=` is silently ignored and lands the admin on /portal.
                      <a
                        href={`/api/enter?slug=${encodeURIComponent(r.tenantSlug)}`}
                        className="text-blue-600 hover:underline"
                      >
                        {r.tenantName}
                      </a>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.suppressed ? (
                      <span
                        className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700"
                        title="Suppressed — mail to this address is refused. Lift it from Outbound Mail."
                      >
                        suppressed
                      </span>
                    ) : (
                      <span className={r.emailsSent ? 'text-gray-700' : 'text-gray-400'}>
                        {r.emailsSent}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500">
        Where they came from is in{' '}
        <Link href="/admin/funnel" className="text-blue-600 hover:underline">Funnel</Link>; what we
        sent them is in{' '}
        <Link href="/admin/crm" className="text-blue-600 hover:underline">Outbound Mail</Link>,
        which is also where a suppression is lifted.
      </p>
    </div>
  );
}
