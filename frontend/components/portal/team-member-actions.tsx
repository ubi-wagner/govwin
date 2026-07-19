'use client';

/**
 * Deactivate / reactivate a team member. A member is never deleted — deactivating
 * revokes their company membership (access off, history kept); reactivating turns it
 * back on. tenant_admin only; hidden for your own row. See
 * docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function TeamMemberActions({
  tenantSlug,
  userId,
  active,
}: {
  tenantSlug: string;
  userId: string;
  active: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const deactivating = active;
    if (deactivating && !confirm('Deactivate this member? Their access is revoked immediately; their history is kept and you can reactivate them anytime.')) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/team/${userId}`, {
        method: deactivating ? 'DELETE' : 'POST',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || 'Action failed');
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      alert('Network error');
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        active
          ? 'text-red-500 hover:bg-red-50 hover:text-red-700'
          : 'text-green-600 hover:bg-green-50 hover:text-green-800'
      }`}
    >
      {busy ? '…' : active ? 'Deactivate' : 'Reactivate'}
    </button>
  );
}
