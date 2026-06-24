'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  tenantSlug: string;
  proposalId: string;
  stage: string;
  userRole: 'admin' | 'contributor' | 'external';
  isLocked: boolean;
};

export function ProposalAiActions({
  tenantSlug,
  proposalId,
  stage,
  userRole,
  isLocked,
}: Props) {
  const router = useRouter();
  const [draftLoading, setDraftLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Outcome state
  const [outcomeLoading, setOutcomeLoading] = useState(false);
  const [selectedOutcome, setSelectedOutcome] = useState<
    'awarded' | 'rejected' | 'withdrawn' | null
  >(null);
  const [outcomeNotes, setOutcomeNotes] = useState('');
  const [outcomeRecorded, setOutcomeRecorded] = useState(false);

  const isAdmin = userRole === 'admin';

  // AI Draft: available for admin when not locked
  const canDraft = isAdmin && !isLocked;
  // Outcome: available for admin when proposal is submitted or archived
  const canRecordOutcome =
    isAdmin && ['submitted', 'archived'].includes(stage);

  const handleDraft = useCallback(async () => {
    if (!canDraft || draftLoading) return;
    setDraftLoading(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/ai/draft`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        setMessage({ type: 'error', text: err.error || 'Draft failed' });
      } else {
        const json = await res.json();
        const count = json.data?.sections_queued ?? 0;
        if (count === 0) {
          setMessage({
            type: 'success',
            text: 'No empty sections to draft.',
          });
        } else {
          setMessage({
            type: 'success',
            text: `AI drafting queued for ${count} section${count > 1 ? 's' : ''}. Content will update shortly.`,
          });
        }
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setDraftLoading(false);
    }
  }, [canDraft, draftLoading, tenantSlug, proposalId]);

  const handleOutcome = useCallback(async () => {
    if (!selectedOutcome || outcomeLoading) return;
    setOutcomeLoading(true);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/outcome`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outcome: selectedOutcome,
            notes: outcomeNotes.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        setMessage({
          type: 'error',
          text: err.error || 'Failed to record outcome',
        });
      } else {
        const json = await res.json();
        const atomsUpdated = json.data?.atomsUpdated ?? 0;
        setOutcomeRecorded(true);
        setMessage({
          type: 'success',
          text: `Outcome recorded as "${selectedOutcome}". ${atomsUpdated} library atom${atomsUpdated !== 1 ? 's' : ''} updated.`,
        });
        router.refresh();
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setOutcomeLoading(false);
    }
  }, [selectedOutcome, outcomeLoading, outcomeNotes, tenantSlug, proposalId, router]);

  if (!isAdmin) return null;

  const outcomeOptions: {
    value: 'awarded' | 'rejected' | 'withdrawn';
    label: string;
    color: string;
    activeColor: string;
  }[] = [
    {
      value: 'awarded',
      label: 'Won',
      color: 'border-gray-200 text-gray-600 hover:border-emerald-300 hover:bg-emerald-50',
      activeColor: 'border-emerald-500 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-500',
    },
    {
      value: 'rejected',
      label: 'Lost',
      color: 'border-gray-200 text-gray-600 hover:border-red-300 hover:bg-red-50',
      activeColor: 'border-red-500 bg-red-50 text-red-700 ring-1 ring-red-500',
    },
    {
      value: 'withdrawn',
      label: 'Withdrawn',
      color: 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50',
      activeColor: 'border-amber-500 bg-amber-50 text-amber-700 ring-1 ring-amber-500',
    },
  ];

  return (
    <div className="space-y-5">
      {/* ── AI Actions ──────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          AI Actions
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Use AI to draft empty sections or review existing content for quality
          and compliance.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleDraft}
            disabled={!canDraft || draftLoading}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-indigo-200 rounded-lg bg-white text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {draftLoading ? (
              <span className="w-4 h-4 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
            ) : (
              <span className="text-indigo-400">&#x2726;</span>
            )}
            {draftLoading ? 'Drafting...' : 'Draft with AI'}
          </button>

          {/* AI color-team review runs via the pipeline agent workforce, which
              is built but not yet wired for V1. Disabled rather than emitting a
              request that nothing processes (admins review sections manually
              during the review stage). */}
          <button
            type="button"
            disabled
            title="AI color-team review is coming soon. During the review stage an admin reviews sections."
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border border-gray-200 rounded-lg bg-gray-50 text-gray-400 cursor-not-allowed"
          >
            <span className="text-gray-300">&#x2726;</span>
            AI Review (coming soon)
          </button>
        </div>
      </div>

      {/* ── Outcome Recording ──────────────────────────────────────── */}
      {canRecordOutcome && !outcomeRecorded && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Record Outcome
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Record the final outcome for this proposal. This updates library
            atom scores to improve future drafts.
          </p>

          {/* Outcome buttons */}
          <div className="flex gap-3 mb-4">
            {outcomeOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSelectedOutcome(opt.value)}
                disabled={outcomeLoading}
                className={`px-4 py-2 text-sm font-medium border rounded-lg transition-all disabled:opacity-50 ${
                  selectedOutcome === opt.value ? opt.activeColor : opt.color
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Notes textarea */}
          {selectedOutcome && (
            <div className="space-y-3">
              <textarea
                value={outcomeNotes}
                onChange={(e) => setOutcomeNotes(e.target.value)}
                placeholder="Optional notes (e.g., feedback from evaluators, reason for withdrawal)..."
                maxLength={2000}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-gray-400">
                  {outcomeNotes.length}/2000
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedOutcome(null);
                      setOutcomeNotes('');
                    }}
                    disabled={outcomeLoading}
                    className="px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleOutcome}
                    disabled={outcomeLoading}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
                  >
                    {outcomeLoading ? (
                      <>
                        <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Saving...
                      </>
                    ) : (
                      `Record as ${outcomeOptions.find((o) => o.value === selectedOutcome)?.label}`
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Outcome already recorded confirmation */}
      {outcomeRecorded && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
          <p className="text-sm font-medium text-emerald-700">
            Outcome recorded successfully. Library atom scores have been
            updated.
          </p>
        </div>
      )}

      {/* ── Status message ─────────────────────────────────────────── */}
      {message && (
        <div
          className={`rounded-lg px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}
    </div>
  );
}
