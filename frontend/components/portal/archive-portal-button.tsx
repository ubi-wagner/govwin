'use client';

/**
 * ArchivePortalButton — archives a whole portal/pipeline (this proposal). Its instantiated workflow
 * instances archive with it (cascade, server-side). Soft + reversible: the portal moves to the
 * Archived list and can be restored; nothing is deleted (S3 cold-storage is a future sweep).
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

export function ArchivePortalButton({ tenantSlug, proposalId }: { tenantSlug: string; proposalId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  const archive = async () => {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        'Archive this portal? It and its workflows move to the Archived list. Reversible anytime — nothing is deleted.',
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'archive' }),
      });
      if (res.ok) {
        router.push(`/portal/${tenantSlug}/proposals`);
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        toast.error(j.error || 'Archive failed');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={archive}
      disabled={busy}
      title="Archive this portal (and its workflows) — reversible, nothing is deleted"
      className="text-xs font-medium text-gray-500 hover:text-amber-700 border border-gray-200 hover:border-amber-300 rounded px-2.5 py-1 disabled:opacity-50 transition-colors"
    >
      {busy ? 'Archiving…' : 'Archive portal'}
    </button>
  );
}
