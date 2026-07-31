'use client';

/**
 * NooksIndex (P8.9) — the tenant admin's list of collaboration vaults ("nooks") with a
 * create action. One nook per external partner; each opens the two-sided NookDetail.
 */
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

interface Vault { id: string; partnerName: string; partnerOrg: string | null; createdAt: string }

export function NooksIndex({ tenantSlug }: { tenantSlug: string }) {
  const [vaults, setVaults] = useState<Vault[] | null>(null);
  const [open, setOpen] = useState(false);
  const [partnerName, setPartnerName] = useState('');
  const [partnerOrg, setPartnerOrg] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/portal/${tenantSlug}/vaults`).then((r) => (r.ok ? r.json() : Promise.reject())).then((b) => setVaults(b.data ?? [])).catch(() => setVaults([]));
  }, [tenantSlug]);
  useEffect(() => { load(); }, [load]);

  const create = useCallback(async () => {
    if (!partnerName.trim()) { setError('Name the partner first.'); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/vaults`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partnerName: partnerName.trim(), partnerOrg: partnerOrg.trim() || null }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setError(body.error || 'Could not create the nook.'); return; }
      setPartnerName(''); setPartnerOrg(''); setOpen(false); load();
    } catch { setError('Network error — try again.'); } finally { setBusy(false); }
  }, [partnerName, partnerOrg, tenantSlug, load]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Collaboration vaults</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            A <strong>nook</strong> is a segregated, partner-specific branch library — the clearing house you and an
            external partner (a subcontractor, a university) both reach. The partner sees <em>only</em> their nook, never
            your main library. You copy content in, they upload theirs, and you harvest what you need into the proposal.
          </p>
        </div>
        <button onClick={() => setOpen(true)} className="shrink-0 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700">＋ New nook</button>
      </div>

      {vaults === null ? <p className="text-sm text-gray-400">Loading…</p> : vaults.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 p-8 text-center text-sm text-gray-400">
          No nooks yet. Create one per external partner you collaborate with.
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {vaults.map((v) => (
            <li key={v.id} className="rounded-lg border bg-white p-4 hover:border-gray-300">
              <Link href={`/portal/${tenantSlug}/vaults/${v.id}`} className="block">
                <div className="text-sm font-semibold text-gray-800">{v.partnerName}</div>
                {v.partnerOrg && <div className="mt-0.5 text-xs text-gray-500">{v.partnerOrg}</div>}
                <div className="mt-2 text-xs text-blue-600">Open nook →</div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-base font-semibold">New collaboration vault</h2>
            <label className="mb-1 block text-xs font-medium text-gray-500">Partner name</label>
            <input autoFocus value={partnerName} onChange={(e) => setPartnerName(e.target.value)} placeholder="e.g. Acme Robotics" className="mb-3 w-full rounded border px-2.5 py-1.5 text-sm" />
            <label className="mb-1 block text-xs font-medium text-gray-500">Organization (optional)</label>
            <input value={partnerOrg} onChange={(e) => setPartnerOrg(e.target.value)} placeholder="e.g. Acme Robotics, Inc." className="mb-4 w-full rounded border px-2.5 py-1.5 text-sm" />
            {error && <p className="mb-2 text-sm text-rose-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50">Cancel</button>
              <button onClick={create} disabled={busy || !partnerName.trim()} className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Creating…' : 'Create nook'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
