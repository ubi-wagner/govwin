'use client';

/**
 * Instant-release button (#7, fast-path only) — one-click release straight from the SLA board.
 *
 * The board only renders this for a portal whose MASTER OPP is already fully built out (readiness.ready),
 * so the common "the solicitation is ready, just release it" case never needs a cockpit trip. It POSTs the
 * SAME auditable route the cockpit uses (/api/admin/provisioning/[portalId]/release) with confirm:false —
 * so if readiness has drifted below the bar since the page loaded, the route returns 409 NOT_READY and we
 * route the admin into the cockpit to curate instead of ever force-releasing something unready.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

export function InstantReleaseButton({ portalId, label }: { portalId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function release() {
    if (busy) return;
    if (!confirm(`Release "${label}" to the customer now? Their build opens unlocked immediately.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/provisioning/${portalId}/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: false }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        toast('Portal released — the customer can build now.', 'success');
        router.refresh();
        return;
      }
      if (res.status === 409 && json?.code === 'NOT_READY') {
        toast('Build-out slipped below the readiness bar — opening the cockpit to curate.', 'info');
        router.push(`/admin/provisioning/${portalId}`);
        return;
      }
      if (res.status === 409 && json?.code === 'CONFLICT') {
        toast('Already released by someone else.', 'info');
        router.refresh();
        return;
      }
      toast(json?.error || 'Release failed.', 'error');
    } catch {
      toast('Release failed — check your connection and retry.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={release}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:opacity-50"
    >
      {busy ? 'Releasing…' : '⚡ Instant release'}
    </button>
  );
}
