'use client';

/**
 * Approve / decline a partner's manager-access request (docs/PARTNER_MANAGER_DESIGN.md §4 Branch B).
 * Approve grants the partner a partner_manager membership on this company.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function ManagerRequestActions({ tenantSlug, taskId }: { tenantSlug: string; taskId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | 'approve' | 'decline'>(null);
  const [err, setErr] = useState<string | null>(null);

  async function act(action: 'approve' | 'decline') {
    setBusy(action); setErr(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/manager-requests/${taskId}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(json?.error || `Failed (${res.status})`); setBusy(null); return; }
      router.refresh();
    } catch { setErr('Network error'); setBusy(null); }
  }

  return (
    <div className="flex items-center gap-2 justify-end">
      {err && <span className="text-xs text-red-600">{err}</span>}
      <button disabled={!!busy} onClick={() => act('approve')}
        className="text-xs px-3 py-1 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50">
        {busy === 'approve' ? '…' : 'Approve'}
      </button>
      <button disabled={!!busy} onClick={() => act('decline')}
        className="text-xs px-3 py-1 rounded border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50">
        {busy === 'decline' ? '…' : 'Decline'}
      </button>
    </div>
  );
}
