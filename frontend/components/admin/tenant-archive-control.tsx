'use client';

/**
 * RFP-admin control to ARCHIVE a company (license slumber) or RESTORE it. Archiving
 * pauses access for every non-admin user of the company at once WITHOUT touching any
 * user's own active/inactive state, so restoring returns everyone to exactly where they
 * were. See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export function TenantArchiveControl({ tenantId, archived }: { tenantId: string; archived: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    const restoring = archived;
    const verb = restoring ? 'Restore' : 'Archive';
    const msg = restoring
      ? 'Restore this company? Access returns for everyone at exactly their prior state.'
      : 'Archive this company (license lapsed)? Access is paused for all its users until you restore it. Nobody is deleted and no work is lost.';
    if (!confirm(msg)) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/archive`, {
        method: restoring ? 'DELETE' : 'POST',
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error || `${verb} failed`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setErr('Network error');
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-end">
      <button
        onClick={toggle}
        disabled={busy}
        className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
          archived
            ? 'bg-green-600 text-white hover:bg-green-700'
            : 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100'
        }`}
      >
        {busy ? '…' : archived ? 'Restore access' : 'Archive (license lapsed)'}
      </button>
      {err && <span className="mt-1 text-[11px] text-red-600">{err}</span>}
    </div>
  );
}
