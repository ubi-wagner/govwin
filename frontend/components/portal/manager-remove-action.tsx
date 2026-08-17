'use client';

/**
 * ManagerRemoveAction (CAP-2) — the tenant_admin "Remove" control on the Team ▸ Managers row.
 * Revokes a partner-manager grant via DELETE .../managers/[membershipId]; the membership flips to
 * 'revoked' (never deleted), so the company drops out of that partner's managed stable. Destructive,
 * so it uses a native confirm() gate (per the UI SOP) + toast for the result.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

export function ManagerRemoveAction({ tenantSlug, membershipId, managerLabel }: { tenantSlug: string; membershipId: string; managerLabel: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (typeof window !== 'undefined' && !window.confirm(
      `Remove ${managerLabel} as a manager of this company? Their manager access is revoked (not deleted) — you can re-grant it later.`,
    )) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/managers/${membershipId}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j.error || 'Failed to remove manager'); return; }
      toast.success('Manager access revoked.');
      router.refresh();
    } catch {
      toast.error('Network error removing manager');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={remove}
      disabled={busy}
      className="text-xs font-medium text-rose-600 hover:text-rose-800 disabled:opacity-50"
    >
      {busy ? 'Removing…' : 'Remove'}
    </button>
  );
}
