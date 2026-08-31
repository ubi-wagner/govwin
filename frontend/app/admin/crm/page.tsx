import { auth } from '@/auth';
import { redirect } from 'next/navigation';
// The ledger and the suppression list are read through `lib/email`, never queried here: only that
// module may touch those tables (enforced by __tests__/email-transport-boundary.test.ts), because
// RLS denies them to the application role and a stray query fails at run time, in front of whoever
// opened the page. sqlBypass below is for `system_events`, which is not a ledger table.
import { sqlBypass } from '@/lib/db';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import { listSuppressions, recentSends, sendTotals, type LedgerRow } from '@/lib/email';
import { SuppressionList } from '@/components/admin/suppression-list';

export const dynamic = 'force-dynamic';

/**
 * /admin/crm — outbound mail, in the platform admin.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────────────────────────────
 * A "Coming soon" placeholder that linked out to a separately-deployed console. Meanwhile the
 * email spine — `email_send_ledger`, `email_suppressions`, the Postmark webhook — was live, wrote
 * on every send, and had NO UI anywhere: nothing in this repository read either table. Every
 * question an operator actually asks about mail ("did it go", "why is this customer not getting
 * anything") was answerable only with SQL.
 *
 * ── WHY IT CAN LIVE HERE NOW ─────────────────────────────────────────────────────────────────
 * Because both tables are in the MAIN database. The ledger moved here with migration 215 and both
 * halves of the platform write it. With Postmark carrying the mail, there is no part of this
 * console that needs the CRM service's own database — so the UI does not have to live in a second
 * application to be complete. That is the consolidation: not a link out, a page.
 *
 * The CRM service keeps what is genuinely its own — message bodies, templates, threads, queue and
 * campaign definitions. What a customer was SENT, and whether they can be reached at all, is
 * platform state and is shown here. docs/CMS_CRM_CONSOLIDATION.md.
 */

const STATUS_TONE: Record<string, string> = {
  sent: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  reserved: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-red-50 text-red-700 border-red-200',
  suppressed: 'bg-gray-100 text-gray-600 border-gray-200',
};

const when = (d: Date | null) => (d ? d.toISOString().replace('T', ' ').slice(0, 16) : '—');

export default async function EmailConsolePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role as Role | undefined;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) redirect('/login');

  // The transport actually in force. Read from the environment rather than assumed, because the
  // most confusing outage is mail "sending" through a driver nobody realised was selected.
  const driver = (process.env.EMAIL_DRIVER || 'gmail').toLowerCase();
  const postmarkConfigured = Boolean(process.env.POSTMARK_SERVER_TOKEN);
  // POSTMARK_WEBHOOK_SECRET — one variable, matching what the route actually checks. The first
  // version of this line invented POSTMARK_WEBHOOK_USER/_PASSWORD, which nothing sets, so the tile
  // would have read "not configured" on a correctly configured system: a confidently wrong
  // operational signal on the page built to show operational truth. `audit-env-inventory` caught
  // it by reporting two env reads no document names.
  const webhookSecured = Boolean(process.env.POSTMARK_WEBHOOK_SECRET);

  let rows: LedgerRow[] = [];
  let totals: { status: string; n: number }[] = [];
  let webhookSeen = 0;
  let loadError: string | null = null;
  try {
    rows = await recentSends(100);
    totals = await sendTotals(30);
    // Has the provider ever called us back? A webhook nobody has exercised is the difference
    // between "no bounces" and "we would not know about a bounce".
    const [w] = await sqlBypass<{ n: number }[]>`
      SELECT count(*)::int AS n FROM system_events
       WHERE namespace = 'system' AND type LIKE 'email.%'
         AND payload->>'source' = 'postmark_webhook'`;
    webhookSeen = w?.n ?? 0;
  } catch (e) {
    console.error('[admin/crm] ledger read failed:', e);
    loadError = 'The send ledger could not be read.';
  }

  const suppressions = await listSuppressions();
  const sent = totals.find((t) => t.status === 'sent')?.n ?? 0;
  const failed = totals.find((t) => t.status === 'failed')?.n ?? 0;
  const stuck = totals.find((t) => t.status === 'reserved')?.n ?? 0;

  return (
    <div className="p-6 max-w-[1500px]">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-gray-900">Outbound mail</h1>
        <p className="text-sm text-gray-500 mt-1">
          Every message the platform has sent, and every address it can no longer reach. One record,
          written by both the app and the CRM service through the same seam.
        </p>
      </div>

      {/* ── Transport state. First, because everything below is meaningless if mail is not
             actually leaving through the driver you think it is. ─────────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">Transport</p>
          <p className="mt-1 text-lg font-semibold capitalize text-gray-900">{driver}</p>
          {driver === 'postmark' && !postmarkConfigured && (
            <p className="mt-1 text-xs text-red-700">
              POSTMARK_SERVER_TOKEN is not set — sends will fail.
            </p>
          )}
          {driver !== 'postmark' && postmarkConfigured && (
            <p className="mt-1 text-xs text-amber-700">
              Postmark is configured but EMAIL_DRIVER selects {driver}.
            </p>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">Sent · 30 days</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-700">{sent}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">Failed · 30 days</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${failed > 0 ? 'text-red-700' : 'text-gray-300'}`}>
            {failed}
          </p>
          {stuck > 0 && (
            // A row reserved and never confirmed is a send that crashed mid-flight. Reserving
            // BEFORE dispatch is what makes that visible instead of invisible — so show it.
            <p className="mt-1 text-xs text-amber-700">{stuck} reserved but never confirmed</p>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-[11px] uppercase tracking-wide text-gray-400">Delivery callbacks</p>
          <p className={`mt-1 text-lg font-semibold tabular-nums ${webhookSeen > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
            {webhookSeen}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {webhookSeen > 0
              ? 'Postmark has reported outcomes.'
              : webhookSecured
                ? 'Webhook credentials set; nothing received yet.'
                : 'Webhook auth not configured — bounces would not reach us.'}
          </p>
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {loadError}
        </div>
      )}

      <SuppressionList initial={suppressions.map((s) => ({
        email: s.email,
        reason: s.reason,
        source: s.source,
        createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
      }))} />

      <h2 className="mt-8 mb-3 text-sm font-semibold text-gray-900">Recent sends</h2>
      {rows.length === 0 && !loadError ? (
        <div className="rounded border border-gray-200 bg-white p-6 text-sm text-gray-500">
          Nothing has been sent yet. Every send — from the app or the CRM service — is reserved here
          before it is dispatched, so this fills in as soon as mail moves.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">To</th>
                <th className="px-3 py-2 font-medium">Subject</th>
                <th className="px-3 py-2 font-medium">Template</th>
                <th className="px-3 py-2 font-medium">Company</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} data-send-id={r.id} className="border-t border-gray-100 align-top hover:bg-gray-50">
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-gray-500">
                    {when(r.sentAt ?? r.createdAt)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-900">{r.toEmail}</td>
                  <td className="max-w-xs px-3 py-2">
                    <div className="truncate text-gray-800" title={r.subject ?? ''}>{r.subject ?? '—'}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {r.template ? r.template.replace(/_/g, ' ') : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {/* No company is CORRECT for platform mail — an admin alert about a tenant is
                        not a send by that tenant. Say so rather than leaving it blank. */}
                    {r.tenantSlug ?? <span className="text-gray-400">platform</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded border px-1.5 py-0.5 text-xs ${STATUS_TONE[r.status] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                      {r.status}
                    </span>
                    {r.error && (
                      <div className="mt-0.5 max-w-xs truncate text-[11px] text-red-700" title={r.error}>
                        {r.error}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
