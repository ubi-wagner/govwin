'use client';

import { useCallback, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────

export interface SourceRegion {
  id: string;
  profileId: string;
  name: string;
  selectorHint: string | null;
  contentContext: string | null;
  regionType: string;
  sampleHtml: string | null;
  sampleText: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

const REGION_TYPE_COLORS: Record<string, string> = {
  listing: 'bg-blue-100 text-blue-800',
  content: 'bg-green-100 text-green-800',
  download: 'bg-purple-100 text-purple-800',
  table: 'bg-yellow-100 text-yellow-800',
  navigation: 'bg-gray-100 text-gray-700',
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// ── Component ────────────────────────────────────────────────────────

interface RegionListProps {
  profileId: string;
  regions: SourceRegion[];
  onDeleted: () => void;
}

export default function RegionList({ profileId, regions, onDeleted }: RegionListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleDelete = useCallback(async (regionId: string) => {
    setDeletingId(regionId);
    try {
      const res = await fetch(`/api/admin/sources/${profileId}/regions/${regionId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error('[region-list] delete failed:', body.error);
      }
      setConfirmId(null);
      onDeleted();
    } catch (err) {
      console.error('[region-list] delete failed:', err);
    } finally {
      setDeletingId(null);
    }
  }, [profileId, onDeleted]);

  if (regions.length === 0) {
    return (
      <div className="text-sm text-gray-500 py-4 text-center bg-white rounded-lg border shadow-sm">
        No regions annotated yet. Add one above to start monitoring specific areas of this source.
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {regions.map((region) => {
        const typeColor = REGION_TYPE_COLORS[region.regionType] ?? REGION_TYPE_COLORS.content;
        const contextPreview = region.contentContext
          ? region.contentContext.length > 100
            ? region.contentContext.slice(0, 100) + '...'
            : region.contentContext
          : null;

        return (
          <div key={region.id} className="bg-white rounded-lg border shadow-sm p-4 space-y-2">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap min-w-0">
                <span className="font-medium text-sm text-gray-900">{region.name}</span>
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${typeColor}`}>
                  {region.regionType}
                </span>
              </div>
              {/* Delete button */}
              {confirmId === region.id ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleDelete(region.id)}
                    disabled={deletingId === region.id}
                    className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-50"
                  >
                    {deletingId === region.id ? '...' : 'Confirm'}
                  </button>
                  <button
                    onClick={() => setConfirmId(null)}
                    className="text-xs px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmId(region.id)}
                  className="text-xs text-red-500 hover:text-red-700 shrink-0"
                  title="Delete region"
                >
                  Delete
                </button>
              )}
            </div>

            {/* Content context preview */}
            {contextPreview && (
              <p className="text-xs text-gray-500">{contextPreview}</p>
            )}

            {/* Selector hint */}
            {region.selectorHint && (
              <div className="text-xs">
                <span className="text-gray-400">Selector: </span>
                <code className="font-mono text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                  {region.selectorHint}
                </code>
              </div>
            )}

            {/* Footer row */}
            <div className="flex items-center gap-3 text-xs text-gray-400 pt-1">
              {region.sampleText ? (
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
                  Has baseline
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-gray-300" />
                  No baseline
                </span>
              )}
              <span>Created {formatDate(region.createdAt)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
