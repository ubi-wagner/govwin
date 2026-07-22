'use client';

import { useCallback, useEffect, useState } from 'react';
import { GuardrailEditor } from './guardrail-editor';
import { recommendedGuardrails } from '@/lib/guardrail-defaults';

interface Portal {
  id: string;
  opportunityId: string;
  proposalId: string | null;
  label: string;
  status: string;
  guardrailConfig: Record<string, unknown> | null;
  launchedAt: string | null;
  paidAt: string | null;
  curationDueAt: string | null;
}

/** "2d 3h 41m" until `iso`, or "overdue" once past. */
function remainingUntil(iso: string, nowMs: number): { text: string; overdue: boolean } {
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 0) return { text: 'overdue', overdue: true };
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  return { text: `${d > 0 ? `${d}d ` : ''}${h}h ${min}m`, overdue: false };
}

export default function ProposalPortals({ tenantSlug, canManage, isExpert = false }: { tenantSlug: string; canManage: boolean; isExpert?: boolean }) {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [newOpp, setNewOpp] = useState('');
  const [label, setLabel] = useState('primary');
  const [now, setNow] = useState(0); // 0 until mounted (avoids SSR hydration mismatch)
  const [editorPortal, setEditorPortal] = useState<string | null>(null); // portal being configured before launch

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

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
                : p.status === 'guardrails_pending' || p.status === 'curation_pending' ? 'bg-amber-100 text-amber-700'
                : p.status === 'closeout' ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>{p.status.replace(/_/g, ' ')}</span>
            </div>

            {p.status === 'curation_pending' && (
              <div className="mb-2 rounded-lg bg-amber-50 border border-amber-200 p-3">
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                  <span className="text-sm font-medium text-amber-900">Waiting for RFP Expert Curation</span>
                </div>
                <p className="text-xs text-amber-700 mt-1">
                  Purchase received. Our RFP expert is building your compliance matrix, volumes, and section
                  molds. Your editable workspace unlocks the moment it&apos;s released.
                </p>
                {p.curationDueAt && now > 0 && (() => {
                  const r = remainingUntil(p.curationDueAt, now);
                  return (
                    <p className={`text-xs mt-1 font-mono ${r.overdue ? 'text-rose-600' : 'text-amber-600'}`}>
                      Expert SLA: {r.overdue ? 'past 72h target' : `${r.text} remaining`}
                    </p>
                  );
                })()}
              </div>
            )}
            {canManage && (
              <div className="flex flex-wrap items-center gap-2">
                {p.status === 'guardrails_pending' && (
                  <button disabled={busy === p.id} onClick={() => setEditorPortal(p.id)} className="text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded px-3 py-1 disabled:opacity-50">Configure &amp; launch</button>
                )}
                {isExpert && p.status === 'curation_pending' && (
                  <button disabled={busy === p.id} onClick={() => portalAction(p.id, 'release')} className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1 disabled:opacity-50" title="Finish curation, provision the build, and unlock it for the customer">
                    {busy === p.id ? 'Releasing…' : 'Release to customer'}
                  </button>
                )}
                {p.proposalId && (
                  <a href={`/portal/${tenantSlug}/proposals/${p.proposalId}`} className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1">Open build &rarr;</a>
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
            {p.status !== 'curation_pending' && (
              <p className="text-[11px] text-gray-400 mt-2">
                {p.proposalId
                  ? <>Build ready — <a href={`/portal/${tenantSlug}/proposals/${p.proposalId}`} className="text-blue-600 hover:underline">open the canvas</a> to run V1. ToDos land in your <a href={`/portal/${tenantSlug}/processes`} className="text-blue-600 hover:underline">task queue</a>.</>
                  : <>ToDos land in your <a href={`/portal/${tenantSlug}/processes`} className="text-blue-600 hover:underline">task queue</a>. Accept guardrails to provision the build.</>}
              </p>
            )}
          </div>
        ))}
        {portals.length === 0 && <p className="text-sm text-gray-400 text-center py-10">No portals yet. Open one from a pinned opportunity.</p>}
      </div>

      {/* Author the build workflow before launch (keyed so each portal gets fresh defaults). */}
      <GuardrailEditor
        key={editorPortal ?? 'none'}
        open={!!editorPortal}
        onClose={() => setEditorPortal(null)}
        initial={recommendedGuardrails()}
        launching={busy === editorPortal}
        onLaunch={async (config) => {
          const id = editorPortal;
          if (!id) return;
          await portalAction(id, 'accept', { guardrailConfig: config });
          setEditorPortal(null);
        }}
      />
    </div>
  );
}
