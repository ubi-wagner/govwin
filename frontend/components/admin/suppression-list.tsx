'use client';
/**
 * Who the platform can no longer email, and the one control that changes it.
 *
 * ── THE STATE NOBODY COULD SEE ───────────────────────────────────────────────────────────────
 * A suppression stops every message to an address — notifications, invitations, nudges, the lot.
 * It is added automatically by the Postmark webhook on a hard bounce or a spam complaint, which is
 * right: mailing a dead address damages the sending domain for every other customer on it.
 *
 * What was missing was the other half. Nothing displayed the list and nothing removed an entry, so
 * a mailbox that was full for one afternoon, an address mistyped once and then corrected, or one
 * colleague hitting "spam" on a notification, ended that person's mail permanently — and the first
 * anyone would know is a customer saying they never hear from us.
 *
 * Lifting is deliberately a blocking confirm rather than a toast-and-undo: it re-opens sending to
 * an address a provider told us was bad, and the reason it was suppressed is right there to read
 * before deciding.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

export interface SuppressionRow {
  email: string;
  reason: string;
  source: string;
  createdAt: string;
}

const REASON_COPY: Record<string, string> = {
  hard_bounce: 'The address does not exist, or rejected us permanently.',
  spam_complaint: 'The recipient marked a message as spam.',
  manual: 'Added by hand.',
};

const REASON_TONE: Record<string, string> = {
  hard_bounce: 'bg-red-50 text-red-700 border-red-200',
  spam_complaint: 'bg-amber-50 text-amber-700 border-amber-200',
  manual: 'bg-gray-100 text-gray-600 border-gray-200',
};

export function SuppressionList({ initial }: { initial: SuppressionRow[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  async function liftOne(row: SuppressionRow) {
    const why = REASON_COPY[row.reason] ?? row.reason.replace(/_/g, ' ');
    if (!confirm(
      `Allow mail to ${row.email} again?\n\n${why}\n\n`
      + 'Sending to an address that is genuinely dead harms deliverability for every other '
      + 'customer on this domain. Lift it only if you know the address works.',
    )) return;

    setBusy(row.email);
    try {
      const res = await fetch('/api/admin/email/suppressions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: row.email }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(json?.error ?? `Could not lift it (${res.status})`, 'error');
        return;
      }
      setRows((r) => r.filter((x) => x.email !== row.email));
      toast(`${row.email} can receive mail again`, 'success');
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not reach the server', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold text-gray-900">
          Blocked addresses{rows.length > 0 ? ` · ${rows.length}` : ''}
        </h2>
        {rows.length > 0 && (
          <p className="text-xs text-gray-500">These receive nothing until they are lifted.</p>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded border border-gray-200 bg-white p-4 text-sm text-gray-500">
          Nobody is blocked. Hard bounces and spam complaints land here automatically, so this
          staying empty is the healthy state — not a sign that nothing is being checked.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">Address</th>
                <th className="px-3 py-2 font-medium">Why</th>
                <th className="px-3 py-2 font-medium">Reported by</th>
                <th className="px-3 py-2 font-medium">Since</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email} data-suppressed={r.email} className="border-t border-gray-100 align-top">
                  <td className="px-3 py-2 font-mono text-xs text-gray-900">{r.email}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded border px-1.5 py-0.5 text-xs ${REASON_TONE[r.reason] ?? 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                      {r.reason.replace(/_/g, ' ')}
                    </span>
                    <div className="mt-0.5 text-[11px] text-gray-500">
                      {REASON_COPY[r.reason] ?? ''}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {r.source === 'postmark_webhook' ? 'the mail provider' : 'an administrator'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-gray-500">
                    {r.createdAt.slice(0, 10)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <button
                      onClick={() => liftOne(r)}
                      disabled={busy === r.email}
                      className="rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
                    >
                      {busy === r.email ? 'Lifting…' : 'Allow mail again'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
