'use client';

/**
 * MemberScopeControl (CAP-3) — a tenant_admin control on Team ▸ Members to scope an internal
 * tenant_user's proposal access: All proposals (tenant-wide, default) OR a chosen set. Writes the
 * membership scope via PATCH .../members/[userId]/scope; resolveUserAccess + the proposals list read
 * it as the single source of truth. Restricting only — "All" clears the scope back to tenant-wide.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

export function MemberScopeControl({
  tenantSlug, userId, memberLabel, allProposals, initialScoped, initialProposals,
}: {
  tenantSlug: string;
  userId: string;
  memberLabel: string;
  allProposals: { id: string; title: string }[];
  initialScoped: boolean;
  initialProposals: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scoped, setScoped] = useState(initialScoped);
  const [selected, setSelected] = useState<Set<string>>(new Set(initialProposals));
  const [busy, setBusy] = useState(false);

  const summary = initialScoped ? `${initialProposals.length} proposal${initialProposals.length === 1 ? '' : 's'}` : 'All proposals';

  function toggle(id: string) {
    setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/members/${userId}/scope`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalScoped: scoped, proposals: scoped ? [...selected] : [] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j.error || 'Failed to update access'); return; }
      toast.success(scoped ? `Access scoped to ${[...selected].length} proposal(s).` : 'Access set to all proposals.');
      setOpen(false);
      router.refresh();
    } catch { toast.error('Network error updating access'); } finally { setBusy(false); }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-medium text-blue-600 hover:text-blue-800" title="Scope this member's proposal access">
        {summary} <span aria-hidden>▾</span>
      </button>
    );
  }

  return (
    <div className="mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-sm text-left">
      <p className="text-[11px] font-semibold text-gray-700 mb-2">Proposal access for {memberLabel}</p>
      <label className="flex items-center gap-2 text-xs mb-1 cursor-pointer">
        <input type="radio" checked={!scoped} onChange={() => setScoped(false)} disabled={busy} /> All proposals
      </label>
      <label className="flex items-center gap-2 text-xs mb-2 cursor-pointer">
        <input type="radio" checked={scoped} onChange={() => setScoped(true)} disabled={busy} /> Specific proposals
      </label>
      {scoped && (
        <div className="max-h-40 overflow-y-auto rounded border border-gray-100 p-1 mb-2">
          {allProposals.length === 0 ? (
            <p className="text-[11px] text-gray-400 px-1 py-2">No proposals yet.</p>
          ) : allProposals.map((p) => (
            <label key={p.id} className="flex items-start gap-2 px-1 py-1 text-xs cursor-pointer hover:bg-gray-50 rounded">
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} disabled={busy} className="mt-0.5" />
              <span className="flex-1 min-w-0 truncate text-gray-700">{p.title}</span>
            </label>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} disabled={busy} className="text-xs text-gray-500 hover:text-gray-800 disabled:opacity-50">Cancel</button>
        <button onClick={save} disabled={busy} className="rounded bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  );
}
