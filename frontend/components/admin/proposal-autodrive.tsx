'use client';

/**
 * Proposal Auto-Drive (Doorbell) — the admin-plane trigger for the tenant proposal build manager.
 * Pick a tenant's proposal + a mode (A/B/C) and Ring: POSTs /api/admin/proposals/[id]/full-draft,
 * which emits proposal:proposal.full_draft_requested (source='admin_doorbell') → the existing
 * OnFullDraftRequested{ModeA,B,C} workflows. Drafts land in review — advisory, never advances a gate.
 */
import { useCallback, useEffect, useState } from 'react';

interface AdminProposal {
  id: string;
  title: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
  stage: string;
  isLocked: boolean;
}

const MODES: { value: 'a' | 'b' | 'c'; label: string }[] = [
  { value: 'a', label: 'A — V0.1 (HITL + AI enablement)' },
  { value: 'b', label: 'B — V0.2 (informed restyle)' },
  { value: 'c', label: 'C — V0.5 (full auto build)' },
];

export default function ProposalAutoDrive() {
  const [proposals, setProposals] = useState<AdminProposal[]>([]);
  const [selected, setSelected] = useState('');
  const [mode, setMode] = useState<'a' | 'b' | 'c'>('a');
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/admin/proposals?limit=100');
        if (!res.ok) {
          if (active) setListError('Could not load proposals');
          return;
        }
        const json = await res.json();
        if (active) setProposals(json?.data?.proposals ?? []);
      } catch {
        if (active) setListError('Network error loading proposals');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const ring = useCallback(async () => {
    if (!selected || loading) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/proposals/${selected}/full-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ type: 'error', text: json?.error || 'Request failed' });
        return;
      }
      setMessage({
        type: 'success',
        text: `Full draft (Mode ${mode.toUpperCase()}) requested. Drafts land in review — watch the tenant's section version history.`,
      });
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setLoading(false);
    }
  }, [selected, mode, loading]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-900">Proposal Auto-Drive (Doorbell)</h3>
        <span className="text-[11px] uppercase tracking-wide text-indigo-600 font-medium">admin → build</span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Ring the tenant proposal build manager on a chosen proposal — no portal descent. Drafts land in
        review (advisory, never advances a gate). Emits <code className="text-[11px]">proposal.full_draft_requested</code> as
        the admin.
      </p>

      {listError ? (
        <p className="text-xs text-red-500">{listError}</p>
      ) : (
        <div className="flex flex-col gap-3">
          <label className="text-xs font-medium text-gray-700">
            Proposal
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none"
            >
              <option value="">Select a proposal…</option>
              {proposals.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.tenantName ?? p.tenantSlug ?? 'tenant')} — {(p.title ?? 'Untitled').slice(0, 60)} [{p.stage}
                  {p.isLocked ? ' · locked' : ''}]
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-medium text-gray-700">
            Mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as 'a' | 'b' | 'c')}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none"
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-3">
            <button
              onClick={ring}
              disabled={!selected || loading}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Ringing…' : 'Ring — Run full draft'}
            </button>
            {message && (
              <span className={`text-xs ${message.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                {message.text}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
