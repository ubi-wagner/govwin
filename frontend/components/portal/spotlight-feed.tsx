'use client';

import { useCallback, useMemo, useState, useTransition } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScoredTopic {
  id: string;
  topicNumber: string | null;
  title: string;
  agency: string | null;
  topicBranch: string | null;
  programType: string | null;
  closeDate: string | null;
  postedDate: string | null;
  matchScore: number;
  matchReasons: string[];
  isPinned: boolean;
  namespace: string | null;
}

type SortField = 'score' | 'closeDate' | 'postedDate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysRemaining(closeDate: string | null): number | null {
  if (!closeDate) return null;
  const diff = new Date(closeDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function formatDate(iso: string | null): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SpotlightFeed({
  topics: initialTopics,
  tenantSlug,
  agencies,
  programTypes,
}: {
  topics: ScoredTopic[];
  tenantSlug: string;
  agencies: string[];
  programTypes: string[];
}) {
  const [topics, setTopics] = useState(initialTopics);
  const [isPending, startTransition] = useTransition();

  // Filters
  const [agencyFilter, setAgencyFilter] = useState<string>('');
  const [programFilter, setProgramFilter] = useState<string>('');
  const [minScore, setMinScore] = useState<number>(0);
  const [sortBy, setSortBy] = useState<SortField>('score');

  // Filtered + sorted list
  const visibleTopics = useMemo(() => {
    let list = topics;

    if (agencyFilter) {
      list = list.filter((t) => t.agency === agencyFilter);
    }
    if (programFilter) {
      list = list.filter((t) => t.programType === programFilter);
    }
    if (minScore > 0) {
      list = list.filter((t) => t.matchScore >= minScore);
    }

    const sorted = [...list];
    if (sortBy === 'score') {
      sorted.sort((a, b) => b.matchScore - a.matchScore);
    } else if (sortBy === 'closeDate') {
      sorted.sort((a, b) => {
        if (!a.closeDate) return 1;
        if (!b.closeDate) return -1;
        return new Date(a.closeDate).getTime() - new Date(b.closeDate).getTime();
      });
    } else if (sortBy === 'postedDate') {
      sorted.sort((a, b) => {
        if (!a.postedDate) return 1;
        if (!b.postedDate) return -1;
        return new Date(b.postedDate).getTime() - new Date(a.postedDate).getTime();
      });
    }

    return sorted;
  }, [topics, agencyFilter, programFilter, minScore, sortBy]);

  // Pin / Unpin
  const togglePin = useCallback(
    (topicId: string, currentlyPinned: boolean) => {
      // Optimistic update
      setTopics((prev) =>
        prev.map((t) => (t.id === topicId ? { ...t, isPinned: !currentlyPinned } : t)),
      );

      startTransition(async () => {
        const method = currentlyPinned ? 'DELETE' : 'POST';
        try {
          const res = await fetch(`/api/portal/${tenantSlug}/spotlight/pin`, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ opportunityId: topicId }),
          });
          if (!res.ok) {
            // Revert on failure
            setTopics((prev) =>
              prev.map((t) =>
                t.id === topicId ? { ...t, isPinned: currentlyPinned } : t,
              ),
            );
          }
        } catch {
          // Revert on network error
          setTopics((prev) =>
            prev.map((t) =>
              t.id === topicId ? { ...t, isPinned: currentlyPinned } : t,
            ),
          );
        }
      });
    },
    [tenantSlug],
  );

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Agency</label>
          <select
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
            value={agencyFilter}
            onChange={(e) => setAgencyFilter(e.target.value)}
          >
            <option value="">All agencies</option>
            {agencies.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Program</label>
          <select
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
          >
            <option value="">All programs</option>
            {programTypes.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Min score
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value) || 0)}
            className="border border-gray-300 rounded px-3 py-1.5 text-sm w-20"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Sort by</label>
          <select
            className="border border-gray-300 rounded px-3 py-1.5 text-sm"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortField)}
          >
            <option value="score">Match score</option>
            <option value="closeDate">Close date</option>
            <option value="postedDate">Posted date</option>
          </select>
        </div>
      </div>

      {/* Results count */}
      <p className="text-sm text-gray-500 mb-4">
        {visibleTopics.length} topic{visibleTopics.length !== 1 ? 's' : ''} found
        {isPending && <span className="ml-2 text-gray-400">Saving...</span>}
      </p>

      {/* Topic cards */}
      {visibleTopics.length === 0 ? (
        <p className="text-gray-400 text-sm py-8 text-center">
          No topics match your current filters.
        </p>
      ) : (
        <ul className="space-y-4">
          {visibleTopics.map((topic) => {
            const days = daysRemaining(topic.closeDate);
            return (
              <li
                key={topic.id}
                className="border border-gray-200 rounded-lg p-5 bg-white"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-semibold text-gray-900 truncate">
                      {topic.topicNumber ? `${topic.topicNumber} - ` : ''}
                      {topic.title}
                    </h3>

                    {/* Badges */}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {topic.agency && (
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-blue-50 text-blue-700">
                          {topic.agency}
                        </span>
                      )}
                      {topic.topicBranch && (
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-purple-50 text-purple-700">
                          {topic.topicBranch}
                        </span>
                      )}
                      {topic.programType && (
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-green-50 text-green-700">
                          {topic.programType}
                        </span>
                      )}
                      {topic.namespace && (
                        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-600">
                          {topic.namespace}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Score circle */}
                  <div className="flex flex-col items-center gap-1 flex-shrink-0">
                    <div
                      className={`w-12 h-12 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                        topic.matchScore >= 75
                          ? 'bg-green-500'
                          : topic.matchScore >= 50
                            ? 'bg-yellow-500'
                            : 'bg-gray-400'
                      }`}
                    >
                      {topic.matchScore}
                    </div>
                    <span className="text-[10px] text-gray-400 uppercase">Score</span>
                  </div>
                </div>

                {/* Match score bar */}
                <div className="mt-3">
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full ${
                        topic.matchScore >= 75
                          ? 'bg-green-500'
                          : topic.matchScore >= 50
                            ? 'bg-yellow-500'
                            : 'bg-gray-400'
                      }`}
                      style={{ width: `${Math.min(100, topic.matchScore)}%` }}
                    />
                  </div>
                </div>

                {/* Close date + days remaining */}
                <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                  <span>Close: {formatDate(topic.closeDate)}</span>
                  {days !== null && (
                    <span
                      className={`font-medium ${
                        days <= 7 ? 'text-red-600' : days <= 30 ? 'text-yellow-600' : 'text-gray-600'
                      }`}
                    >
                      {days === 0 ? 'Closes today' : `${days} day${days !== 1 ? 's' : ''} remaining`}
                    </span>
                  )}
                </div>

                {/* Why this matches */}
                {topic.matchReasons.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-500 mb-1">
                      Why this matches:
                    </p>
                    <ul className="flex flex-wrap gap-1">
                      {topic.matchReasons.map((reason) => (
                        <li
                          key={reason}
                          className="inline-flex items-center px-2 py-0.5 text-xs rounded bg-amber-50 text-amber-700"
                        >
                          {reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3 mt-4 pt-3 border-t border-gray-100">
                  <button
                    type="button"
                    onClick={() => togglePin(topic.id, topic.isPinned)}
                    className={`px-3 py-1.5 text-sm rounded font-medium ${
                      topic.isPinned
                        ? 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                    }`}
                  >
                    {topic.isPinned ? 'Unpin' : 'Pin'}
                  </button>
                  <a
                    href={`/portal/${tenantSlug}/purchase?topic=${topic.id}`}
                    className="px-3 py-1.5 text-sm rounded font-medium bg-brand-600 text-white hover:bg-brand-700"
                  >
                    Purchase Portal
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
