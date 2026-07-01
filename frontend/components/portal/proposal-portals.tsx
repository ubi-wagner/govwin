'use client';

import { useCallback, useEffect, useState } from 'react';

interface Portal {
  id: string;
  opportunityId: string;
  label: string;
  status: string;
  guardrailConfig: Record<string, unknown> | null;
  launchedAt: string | null;
}

/** A minimal valid guardrail config (within the RFP-admin limits: 3 stages, ≤3 nudges). */
const DEFAULT_GUARDRAILS = {
  nudgeDays: [2, 5, 9],
  collaborators: [{ email: 'me@tenant', role: 'manager', stages: ['draft', 'review', 'final'] }],
  stages: [
    { key: 'draft', label: 'Draft', todos: [{ type: 'complete_sections', assigneeRole: 'tenant_user', dueDays: 7, title: 'Draft: complete the sections' }] },
    { key: 'review', label: 'Review', todos: [{ type: 'acknowledge', assigneeRole: 'tenant_admin', title: 'Review: acknowledge the draft' }] },
    { key: 'final', label: 'Final', todos: [{ type: 'upload_documents', assigneeRole: 'tenant_admin', title: 'Final: upload the submission docs' }] },
  ],
};

export default function ProposalPortals({ tenantSlug, canManage }: { tenantSlug: string; canManage: boolean }) {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [newOpp, setNewOpp] = useState('');
  const [label, setLabel] = useState('primary');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/portals`);
      if (res.ok) setPortals((await res.json()).data?.portals ?? []);
    } catch { /* keep */ }
  }, [tenantSlug]);

  useEffect(() => {
    load();
    const opp = new URLSearchParams(window.location.search).get('opp');
    if (opp) setNewOpp(opp);
  }, [load]);

  const create = useCallback(async () => {
    if (!newOpp.trim()) return;
    setBusy('new');
    try {
      await fetch(`/api/portal/${tenantSlug}/portals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opportunityId: newOpp.trim(), label: label.trim() || 'primary' }) });
      setNewOpp(''); setLabel('primary');
      await load();
    } catch { /* ignore */ } finally { setBusy(null); }
  }, [tenantSlug, newOpp, label, load]);

  const portalAction = useCallback(async (id: string, action: string, body?: unknown) => {
    setBusy(id);
    try {
      await fetch(`/api/portal/${tenantSlug}/portals/${id}?action=${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
      });
      await load();
    } catch { /* ignore */ } finally { setBusy(null); }
  }, [tenantSlug, load]);

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="border border-gray-200 rounded-xl p-4 bg-white flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Opportunity ID</label>
            <input value={newOpp} onChange={(e) => setNewOpp(e.target.value)} placeholder="opportunity uuid" className="border border-gray-300 rounded px-2 py-1.5 text-sm w-80" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Label (multi-proposal)</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm w-40" />
          </div>
          <button disabled={busy === 'new' || !newOpp.trim()} onClick={create} className="text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-4 py-1.5 disabled:opacity-50">Open portal</button>
        </div>
      )}

      <div className="space-y-3">
        {portals.map((p) => (
          <div key={p.id} className="border border-gray-200 rounded-xl p-4 bg-white">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-sm font-semibold text-gray-800">{p.label}</span>
                <span className="text-[11px] text-gray-400 ml-2">{p.opportunityId.slice(0, 8)}…</span>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-medium ${
                p.status === 'launched' || p.status === 'executing' ? 'bg-green-100 text-green-700'
                : p.status === 'guardrails_pending' ? 'bg-amber-100 text-amber-700'
                : p.status === 'closeout' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>{p.status.replace(/_/g, ' ')}</span>
            </div>
            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                {p.status === 'guardrails_pending' && (
                  <button disabled={busy === p.id} onClick={() => portalAction(p.id, 'accept', { guardrailConfig: DEFAULT_GUARDRAILS })} className="text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded px-3 py-1 disabled:opacity-50">Accept guardrails &amp; launch</button>
                )}
                {(p.status === 'launched' || p.status === 'executing') && (
                  <>
                    <button disabled={busy === p.id} onClick={() => portalAction(p.id, 'advance-stage')} className="text-xs font-medium text-blue-700 border border-blue-200 rounded px-3 py-1 hover:bg-blue-50">Advance stage</button>
                    <button disabled={busy === p.id} onClick={() => portalAction(p.id, 'advance-stage', { force: true })} className="text-xs text-gray-500 border border-gray-200 rounded px-3 py-1 hover:bg-gray-50">Force advance</button>
                  </>
                )}
                <button disabled={busy === p.id} onClick={() => portalAction(p.id, 'revoke-shadow')} className="text-xs text-rose-600 border border-rose-200 rounded px-2.5 py-1 hover:bg-rose-50 ml-auto">Revoke shadow admin</button>
              </div>
            )}
            <p className="text-[11px] text-gray-400 mt-2">ToDos land in your <a href={`/portal/${tenantSlug}/processes`} className="text-blue-600 hover:underline">task queue</a>.</p>
          </div>
        ))}
        {portals.length === 0 && <p className="text-sm text-gray-400 text-center py-10">No portals yet. Open one from a pinned opportunity.</p>}
      </div>
    </div>
  );
}
