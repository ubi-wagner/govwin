'use client';

/**
 * Proposal Studio — the 3-phase (Draft → Refine → Compliance) gated draft wizard.
 * Each phase runs its agent cohort; at the gate the admin previews the document, comments, and either
 * REGENERATES the phase with those comments or APPROVES → next. A "Run all 3 automatically" button is
 * the doorbell auto-chain. Advisory: drafts land in review; the Studio never locks or submits.
 * docs/PROPOSAL_STUDIO_DESIGN.md.
 */
import { useCallback, useEffect, useState } from 'react';

interface Props {
  tenantSlug: string;
  proposalId: string;
}

const PHASES = [
  { key: 'draft', label: '1 · Draft', desc: 'Plan + draft every section from the library atoms' },
  { key: 'refine', label: '2 · Refine', desc: 'Reformat + restyle to one house style + cost + package' },
  { key: 'compliance', label: '3 · Compliance', desc: 'Requirement coverage + continuity + redaction scan' },
] as const;

type Phase = 'draft' | 'refine' | 'compliance' | 'complete' | null;
type Status = 'running' | 'awaiting_review' | null;

export default function ProposalStudio({ tenantSlug, proposalId }: Props) {
  const [phase, setPhase] = useState<Phase>(null);
  const [status, setStatus] = useState<Status>(null);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);

  const base = `/api/portal/${tenantSlug}/proposals/${proposalId}/studio`;

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(base);
      if (!res.ok) return;
      const j = await res.json();
      setPhase(j?.data?.studioPhase ?? null);
      setStatus(j?.data?.studioPhaseStatus ?? null);
    } catch { /* non-fatal */ }
  }, [base]);

  useEffect(() => { refresh(); }, [refresh]);
  // While a loop is running, poll so the gate opens as soon as the phase completes.
  useEffect(() => {
    if (status !== 'running') return;
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [status, refresh]);

  const call = useCallback(
    async (action: 'start' | 'regenerate' | 'approve', extra: { auto?: boolean; guidance?: string } = {}) => {
      setLoading(true);
      setMsg(null);
      try {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...extra }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMsg({ type: 'error', text: j?.error || 'Request failed' });
          return;
        }
        const p = j?.data?.phase as Phase;
        setPhase(p);
        setStatus(p === 'complete' ? null : 'running');
        setComment('');
        setMsg({
          type: 'success',
          text:
            action === 'start'
              ? extra.auto
                ? 'Running all 3 loops automatically — drafts land in review.'
                : 'Draft loop started — drafts land in review.'
              : action === 'regenerate'
                ? 'Regenerating this loop with your comments…'
                : p === 'complete'
                  ? 'Studio complete — drafted + reviewed. Lock/submit when ready.'
                  : 'Approved → advancing to the next loop…',
        });
      } catch {
        setMsg({ type: 'error', text: 'Network error' });
      } finally {
        setLoading(false);
      }
    },
    [base],
  );

  const openPreview = useCallback(async () => {
    setShowPreview(true);
    setPreviewHtml(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/preview`);
      if (res.ok) {
        const j = await res.json();
        setPreviewHtml(j?.data?.html ?? '<p style="padding:24px">No content yet.</p>');
      } else {
        setPreviewHtml('<p style="padding:24px">Preview unavailable.</p>');
      }
    } catch {
      setPreviewHtml('<p style="padding:24px">Preview failed to load.</p>');
    }
  }, [tenantSlug, proposalId]);

  const activeIdx = phase === 'complete' ? PHASES.length : PHASES.findIndex((p) => p.key === phase);
  const notStarted = phase === null;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-900">Proposal Studio</h3>
        <span className="text-[11px] uppercase tracking-wide text-indigo-600 font-medium">draft → refine → compliance</span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Three gated loops over the agent fabric. Review the document at each gate, comment + regenerate, or
        approve → next. Advisory — drafts land in review; nothing locks or submits.
      </p>

      {/* Stepper — stacks to one column on mobile so each phase stays readable */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        {PHASES.map((p, i) => {
          const done = i < activeIdx || phase === 'complete';
          const active = p.key === phase;
          return (
            <div key={p.key} className="flex-1">
              <div
                className={`rounded-lg border px-3 py-2 ${
                  active ? 'border-indigo-400 bg-indigo-50' : done ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'
                }`}
                title={p.desc}
              >
                <div className={`text-xs font-semibold ${active ? 'text-indigo-700' : done ? 'text-green-700' : 'text-gray-500'}`}>
                  {done && !active ? '✓ ' : ''}{p.label}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5 leading-tight">{p.desc}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* State-specific controls */}
      {notStarted && (
        <div className="flex items-center gap-3">
          <button
            onClick={() => call('start')}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Starting…' : 'Start — Draft loop'}
          </button>
          <button
            onClick={() => call('start', { auto: true })}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-indigo-700 bg-white border border-indigo-300 rounded-md hover:bg-indigo-50 disabled:opacity-50 transition-colors"
            title="Run Draft → Refine → Compliance automatically (the doorbell)"
          >
            Run all 3 automatically
          </button>
        </div>
      )}

      {phase === 'complete' && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-3">
          Studio complete — the proposal is drafted + reviewed across all three loops. Lock the sections and
          advance the stage when you’re ready to submit.
        </div>
      )}

      {!notStarted && phase !== 'complete' && status === 'running' && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse mr-2" />
            {PHASES.find((p) => p.key === phase)?.label} loop running — the agents are working; drafts land in review.
          </span>
          <button onClick={refresh} className="text-xs text-indigo-600 hover:underline">Refresh</button>
        </div>
      )}

      {!notStarted && phase !== 'complete' && status === 'awaiting_review' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-800">
              {PHASES.find((p) => p.key === phase)?.label} loop ready for review.
            </span>
            <button onClick={openPreview} className="text-sm text-indigo-600 hover:underline">Preview document →</button>
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Comments to steer the regeneration of this loop (optional)…"
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={() => call('regenerate', comment.trim() ? { guidance: comment.trim() } : {})}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-indigo-700 bg-white border border-indigo-300 rounded-md hover:bg-indigo-50 disabled:opacity-50 transition-colors"
            >
              Regenerate with comments
            </button>
            <button
              onClick={() => call('approve')}
              disabled={loading}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {phase === 'compliance' ? 'Approve → complete' : 'Approve → next loop'}
            </button>
          </div>
        </div>
      )}

      {msg && (
        <p className={`mt-3 text-xs ${msg.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>{msg.text}</p>
      )}

      {/* Preview modal — the rendered document, exactly as it downloads (sandboxed, static HTML). */}
      {showPreview && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-lg w-full max-w-4xl h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="text-sm font-semibold text-gray-800">Document preview — as it downloads</span>
              <button onClick={() => setShowPreview(false)} className="text-sm text-gray-500 hover:text-gray-800">Close ✕</button>
            </div>
            {previewHtml === null ? (
              <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading preview…</div>
            ) : (
              <iframe title="studio-preview" sandbox="" srcDoc={previewHtml} className="flex-1 w-full rounded-b-lg" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
