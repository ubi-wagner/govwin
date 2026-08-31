'use client';

/**
 * StrategyPanel (#1) — surfaces the OnProposalCreated advisory AI actors read-only.
 *
 * Capture strategy, market research, past-performance matches, and cost-realism guidance run
 * when a proposal is created but never reached a UI. This fetches /strategy and renders each
 * produced brief. SELF-HIDES when there is nothing to show (no run yet, or it produced none),
 * so it only appears when there's real advisory content — no empty clutter. Advisory: it
 * displays, never writes. Mobile-safe (break-words, per-section scroll, no fixed widths).
 */
import { useEffect, useState } from 'react';
import type { ProposalStrategy } from '@/lib/proposal/strategy';
import { fmtDate } from '@/lib/fmt';

export function StrategyPanel({ tenantSlug, proposalId }: { tenantSlug: string; proposalId: string }) {
  const [data, setData] = useState<ProposalStrategy | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/strategy`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j?.data) setData(j.data as ProposalStrategy); })
      .catch(() => { /* self-hides on failure */ });
    return () => { alive = false; };
  }, [tenantSlug, proposalId]);

  // Self-hide until we know there's something to show.
  if (!data || !data.hasAny) return null;

  return (
    <section className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-indigo-900">
            Capture strategy &amp; research
            <span className="ml-2 text-[11px] font-normal text-indigo-500">advisory · AI-generated</span>
          </h3>
          {data.generatedAt && (
            <p className="mt-0.5 text-xs text-indigo-400">Generated {fmtDate(data.generatedAt)}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center min-h-11 px-2 text-xs font-medium text-indigo-600 hover:text-indigo-800"
          aria-expanded={open}
        >
          {open ? 'Hide' : `Show ${data.sections.length} brief${data.sections.length > 1 ? 's' : ''}`}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-3">
          {data.sections.map((s) => (
            <div key={s.key} className="rounded-lg border border-indigo-100 bg-white p-3">
              <p className="text-xs font-semibold text-gray-900">{s.label}</p>
              <p className="text-[11px] text-gray-400">{s.blurb}</p>
              <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm text-gray-700">
                {s.text}
              </div>
            </div>
          ))}
          <p className="text-[10px] text-indigo-400">
            From the capture strategist &amp; research scout when this proposal was created — advisory, for your review.
          </p>
        </div>
      )}
    </section>
  );
}
