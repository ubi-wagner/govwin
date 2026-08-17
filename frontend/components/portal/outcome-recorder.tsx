'use client';

/**
 * OutcomeRecorder — the submitted→outcome→(award⇒contract kickoff) step, surfaced as a first-class,
 * discoverable card at the TOP of the proposal workspace (under the stage bar) rather than buried in
 * a nested AI tab. One source of truth: mounted once by ProposalWorkspace when a proposal is
 * submitted/final and the viewer is an admin. Recording a win fires the existing awarded→contract
 * kickoff workflow (the route returns `contractStarted`); every outcome tunes library atom scores.
 * Advisory posture: read-only until the admin explicitly records. Self-hides otherwise.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/lib/toast';

type Outcome = 'awarded' | 'rejected' | 'withdrawn';

const OPTIONS: { value: Outcome; label: string; color: string; activeColor: string }[] = [
  { value: 'awarded', label: 'Won', color: 'border-gray-200 text-gray-600 hover:border-emerald-300 hover:bg-emerald-50', activeColor: 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500' },
  { value: 'rejected', label: 'Lost', color: 'border-gray-200 text-gray-600 hover:border-red-300 hover:bg-red-50', activeColor: 'border-red-500 bg-red-50 text-red-700 ring-1 ring-red-500' },
  { value: 'withdrawn', label: 'Withdrawn', color: 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50', activeColor: 'border-amber-500 bg-amber-50 text-amber-700 ring-1 ring-amber-500' },
];

export function OutcomeRecorder({ tenantSlug, proposalId, stage, isAdmin }: { tenantSlug: string; proposalId: string; stage: string; isAdmin: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Outcome | null>(null);
  const [notes, setNotes] = useState('');
  const [recorded, setRecorded] = useState(false);

  // Admin + submitted/final only — mirrors the outcome route's accepted preconditions (it 409s on
  // 'archived' = already recorded, 400s on any other stage).
  const canRecord = isAdmin && ['submitted', 'final'].includes(stage);
  if (!canRecord && !recorded) return null;

  async function submit() {
    if (!selected || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/outcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome: selected, notes: notes.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(json.error || 'Failed to record outcome'); return; }
      const atomsUpdated = json.data?.atomsUpdated ?? 0;
      const contract = json.data?.contractStarted as { contractId: string; kickoffLaunched: boolean } | null;
      const label = OPTIONS.find((o) => o.value === selected)?.label ?? selected;
      setRecorded(true);
      toast.success(
        `Outcome recorded as "${label}". ${atomsUpdated} library atom${atomsUpdated !== 1 ? 's' : ''} updated.` +
        (contract ? ` 🏆 Contract started${contract.kickoffLaunched ? ' — a kickoff task is in your queue.' : '.'}` : ''),
      );
      router.refresh();
    } catch { toast.error('Network error recording outcome'); } finally { setLoading(false); }
  }

  if (recorded) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-medium text-emerald-700">Outcome recorded — library atom scores updated. A win also starts the contract + kickoff.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-5">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span aria-hidden>🏁</span>
        <h3 className="text-sm font-semibold text-gray-900">Record the outcome</h3>
        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-medium text-indigo-700">{stage}</span>
      </div>
      <p className="text-sm text-gray-600 mb-4">
        This proposal is submitted. Record the final result — a <span className="font-medium text-emerald-700">win</span> starts
        the contract and drops a kickoff task in your queue; every outcome tunes your library atom scores for future drafts.
      </p>
      <div className="flex flex-wrap gap-3 mb-4">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setSelected(opt.value)}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium border rounded-lg transition-all disabled:opacity-50 ${selected === opt.value ? opt.activeColor : opt.color}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {selected && (
        <div className="space-y-3">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes (e.g., feedback from evaluators, reason for withdrawal)…"
            maxLength={2000}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-400">{notes.length}/2000</span>
            <div className="flex gap-2">
              <button onClick={() => { setSelected(null); setNotes(''); }} disabled={loading} className="px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors">Cancel</button>
              <button onClick={submit} disabled={loading} className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {loading ? (<><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />Saving…</>) : `Record as ${OPTIONS.find((o) => o.value === selected)?.label}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
