'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

interface SpotlightDetailActionsProps {
  tenantSlug: string;
  opportunityId: string;
  isPinned: boolean;
  proposalId: string | null;
  proposalStage: string | null;
}

export default function SpotlightDetailActions({
  tenantSlug,
  opportunityId,
  isPinned: initialPinned,
  proposalId,
  proposalStage,
}: SpotlightDetailActionsProps) {
  const router = useRouter();
  const [isPinned, setIsPinned] = useState(initialPinned);
  const [isPinPending, startPinTransition] = useTransition();
  const [isCreatePending, startCreateTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleTogglePin() {
    const previousState = isPinned;
    setIsPinned(!previousState);
    setError(null);

    startPinTransition(async () => {
      const method = previousState ? 'DELETE' : 'POST';
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/spotlight/pin`, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ opportunityId }),
        });
        if (!res.ok) {
          setIsPinned(previousState);
          const data = await res.json().catch(() => null);
          setError(data?.error ?? 'Failed to update pin status');
        } else {
          router.refresh();
        }
      } catch {
        setIsPinned(previousState);
        setError('Network error');
      }
    });
  }

  function handleBuildProposal() {
    setError(null);

    startCreateTransition(async () => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/proposals/create`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topicId: opportunityId }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          setError(data?.error ?? 'Failed to create proposal');
          return;
        }

        const data = await res.json();
        if (data?.data?.proposalId) {
          router.push(`/portal/${tenantSlug}/proposals/${data.data.proposalId}`);
        } else {
          router.refresh();
        }
      } catch {
        setError('Network error');
      }
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Pin / Unpin button */}
      <button
        type="button"
        onClick={handleTogglePin}
        disabled={isPinPending}
        className={`px-4 py-2 text-sm rounded-lg font-medium transition-colors disabled:opacity-50 ${
          isPinned
            ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
        }`}
      >
        {isPinPending ? 'Saving...' : isPinned ? 'Unpin from Spotlight' : 'Pin to Spotlight'}
      </button>

      {/* Build Proposal or Go to Proposal */}
      {proposalId ? (
        <a
          href={`/portal/${tenantSlug}/proposals/${proposalId}`}
          className="inline-flex items-center px-4 py-2 text-sm rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          Go to Proposal
          {proposalStage && (
            <span className="ml-2 px-1.5 py-0.5 text-xs rounded bg-indigo-500 text-indigo-100">
              {proposalStage.replace(/_/g, ' ')}
            </span>
          )}
        </a>
      ) : isPinned ? (
        <button
          type="button"
          onClick={handleBuildProposal}
          disabled={isCreatePending}
          className="px-4 py-2 text-sm rounded-lg font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition-colors disabled:opacity-50"
        >
          {isCreatePending ? 'Creating...' : 'Build Proposal'}
        </button>
      ) : null}

      {error && (
        <span className="text-sm text-red-600">{error}</span>
      )}
    </div>
  );
}
