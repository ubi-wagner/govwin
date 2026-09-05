'use client';

/**
 * "End access" — the one act this page was missing.
 *
 * `/admin/workspace-access` could see that somebody was inside a customer's workspace and do
 * nothing about it. Every other closer is the actor themselves or the clock; this is the only one a
 * second person can cause.
 *
 * ── WHY IT SAYS "for 30 minutes" ON THE BUTTON'S CONFIRM ─────────────────────────────────────
 * Because it is a cooldown and not a ban, and an operator who thinks they have permanently removed
 * somebody would be wrong in a way that matters. An rfp_admin has no descent flag to clear — being
 * on the portal URL *is* the descent — so time is the only mechanism that holds without inventing a
 * grant model this product does not have.
 *
 * A native `confirm()` rather than a toast-and-undo: this writes into a customer's audit trail and
 * interrupts a colleague mid-task, which is the shape of act this repo keeps behind a blocking
 * gate. `toast()` reports the OUTCOME, per the house rule.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

export function EndAccessButton({
  userId, tenantId, who, company,
}: { userId: string; tenantId: string; who: string; company: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function end() {
    if (!confirm(
      `End ${who}'s access to ${company} now?\n\n`
      + 'They will be returned to their own console and told an administrator ended it. '
      + 'They can enter again after 30 minutes — this is not a permanent block.',
    )) return;

    setBusy(true);
    try {
      const res = await fetch('/api/admin/workspace-access/force-ascend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, tenantId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { toast(body?.error || 'Could not end the session', 'error'); return; }
      // `closed: 0` means they had already left. Saying so beats implying an eviction that never
      // happened — the operator would otherwise believe they had acted when nothing changed.
      const n = body?.data?.closed ?? 0;
      toast(
        n > 0 ? `Ended ${who}'s access to ${company}.` : `${who} had already left ${company}.`,
        n > 0 ? 'success' : 'info',
      );
      router.refresh();
    } catch {
      toast('Could not reach the server', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={end}
      disabled={busy}
      className="rounded border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium
                 text-red-700 hover:bg-red-100 disabled:opacity-50"
    >
      {busy ? '…' : 'End access'}
    </button>
  );
}
