'use client';

/**
 * Admin "pin for updates" toggle (RANK-8). Arms/disarms update-monitoring on a master opportunity:
 * once watched, a re-push (amendment/change) fans an elevated update notification to every tenant
 * holding its mirror card — pre-purchase. rfp_admin+ only (the route re-checks). Optimistic + reverts
 * on failure.
 */
import { useState } from 'react';
import { toast } from '@/lib/toast';

export function OppWatchToggle({ opportunityId, initial }: { opportunityId: string; initial: boolean }) {
  const [watching, setWatching] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const next = !watching;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/opportunities/${opportunityId}/watch`, { method: next ? 'POST' : 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Could not update the watch');
        return;
      }
      setWatching(next);
      toast.success(next ? 'Watching for updates — holders will be notified on changes' : 'Stopped watching for updates');
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={watching ? 'Watching — click to stop notifying holders on updates' : 'Watch this opportunity — notify every holder on a re-push/amendment'}
      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        watching ? 'bg-blue-600 text-white hover:bg-blue-700' : 'border border-gray-300 text-gray-500 hover:bg-gray-100'
      }`}
    >
      {watching ? '🔔 Watching' : 'Watch'}
    </button>
  );
}
