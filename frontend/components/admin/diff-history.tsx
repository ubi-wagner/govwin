'use client';

import { useCallback, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────

export interface SourceDiffDetail {
  id: string;
  profileId: string;
  regionId: string | null;
  isMeaningful: boolean;
  summary: string | null;
  severity: string;
  claudeModel: string | null;
  claudeTokensUsed: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  regionName: string | null;
  extractedOpportunities?: unknown[];
}

// ── Helpers ──────────────────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  info: 'bg-gray-100 text-gray-700',
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ── Component ────────────────────────────────────────────────────────

interface DiffHistoryProps {
  profileId: string;
  diffs: SourceDiffDetail[];
  onReviewed: () => void;
}

export default function DiffHistory({ profileId, diffs, onReviewed }: DiffHistoryProps) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const handleReview = useCallback(async (diffId: string) => {
    setReviewingId(diffId);
    try {
      const res = await fetch(`/api/admin/sources/${profileId}/diffs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diffId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('[diff-history] review failed:', body.error);
      }
      onReviewed();
    } catch (err) {
      console.error('[diff-history] review failed:', err);
    } finally {
      setReviewingId(null);
    }
  }, [profileId, onReviewed]);

  if (diffs.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4 text-center bg-white rounded-lg border shadow-sm">
        No change history yet. Changes will appear here after scout runs detect differences.
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border shadow-sm divide-y">
      {diffs.map((diff) => {
        const severityColor = SEVERITY_COLORS[diff.severity] ?? SEVERITY_COLORS.info;
        const opCount = Array.isArray(diff.extractedOpportunities) ? diff.extractedOpportunities.length : 0;

        return (
          <div key={diff.id} className="flex items-start gap-3 px-4 py-3">
            {/* Timestamp */}
            <div className="text-xs text-gray-400 w-24 shrink-0 pt-0.5">
              {formatRelative(diff.createdAt)}
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Severity badge */}
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${severityColor}`}>
                  {diff.severity}
                </span>

                {/* Region name */}
                {diff.regionName && (
                  <span className="text-xs font-medium text-gray-700">{diff.regionName}</span>
                )}

                {/* Meaningful / Noise indicator */}
                {diff.isMeaningful ? (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                    Meaningful
                  </span>
                ) : (
                  <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                    Noise
                  </span>
                )}

                {/* Extracted opportunities count */}
                {opCount > 0 && (
                  <span className="text-xs text-indigo-600 font-medium">
                    {opCount} opportunit{opCount === 1 ? 'y' : 'ies'}
                  </span>
                )}
              </div>

              {/* Summary */}
              {diff.summary && (
                <p className="text-sm text-gray-600">{diff.summary}</p>
              )}

              {/* Reviewed status */}
              {diff.reviewedAt && (
                <span className="text-xs text-gray-400">
                  Reviewed {formatRelative(diff.reviewedAt)}
                </span>
              )}
            </div>

            {/* Review button */}
            <div className="shrink-0">
              {diff.reviewedAt ? (
                <span className="inline-flex items-center gap-1 text-xs text-green-600">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                  Reviewed
                </span>
              ) : (
                <button
                  onClick={() => handleReview(diff.id)}
                  disabled={reviewingId === diff.id}
                  className="text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-50"
                >
                  {reviewingId === diff.id ? '...' : 'Review'}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
