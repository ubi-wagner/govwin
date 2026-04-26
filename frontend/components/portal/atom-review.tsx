'use client';

import { useState, useCallback, useMemo } from 'react';

const CATEGORIES = [
  'general',
  'technical_approach',
  'past_performance',
  'key_personnel',
  'capability_statement',
  'cost_volume',
  'management_approach',
  'commercialization',
  'abstract',
  'qualifications',
  'schedule',
  'risk_management',
  'quality',
  'facilities',
  'teaming',
  'security',
  'transition_plan',
  'data_rights',
] as const;

type ReviewStatus = 'pending' | 'accepted' | 'rejected';

interface AtomState {
  id: string;
  content: string;
  category: string;
  tags: string[];
  headingText: string | null;
  confidence: number;
  canvasNodes?: unknown;
  reviewStatus: ReviewStatus;
  expanded: boolean;
  markedForSplit: boolean;
  saving: boolean;
  error: string | null;
}

interface AtomReviewProps {
  tenantSlug: string;
  atoms: Array<{
    id: string;
    content: string;
    category: string;
    tags: string[];
    headingText: string | null;
    confidence: number;
    canvasNodes?: unknown;
  }>;
  sourceFilename: string;
  documentMetadata?: {
    title?: string;
    author?: string;
    pageCount?: number;
  };
  onComplete: () => void;
}

export default function AtomReview({
  tenantSlug,
  atoms: initialAtoms,
  sourceFilename,
  documentMetadata,
  onComplete,
}: AtomReviewProps) {
  const [atomStates, setAtomStates] = useState<AtomState[]>(() =>
    initialAtoms.map((a) => ({
      ...a,
      reviewStatus: 'pending',
      expanded: false,
      markedForSplit: false,
      saving: false,
      error: null,
    })),
  );

  const [bulkCategory, setBulkCategory] = useState('');

  const reviewed = useMemo(
    () => atomStates.filter((a) => a.reviewStatus !== 'pending').length,
    [atomStates],
  );
  const total = atomStates.length;

  const updateAtom = useCallback(
    (id: string, updates: Partial<AtomState>) => {
      setAtomStates((prev) => {
        const next = prev.map((a) =>
          a.id === id ? { ...a, ...updates } : a,
        );
        return next;
      });
    },
    [],
  );

  // ---- Accept single atom ----
  const acceptAtom = useCallback(
    async (id: string) => {
      // Read current state to get latest category/tags
      let category = '';
      let tags: string[] = [];
      setAtomStates((prev) => {
        const atom = prev.find((a) => a.id === id);
        if (atom) {
          category = atom.category;
          tags = atom.tags;
        }
        return prev.map((a) =>
          a.id === id ? { ...a, saving: true, error: null } : a,
        );
      });

      try {
        const res = await fetch(
          `/api/portal/${tenantSlug}/library/${id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              status: 'approved',
              category,
              tags,
            }),
          },
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Request failed' }));
          updateAtom(id, { saving: false, error: data.error ?? 'Accept failed' });
          return;
        }

        setAtomStates((prev) => {
          const next = prev.map((a) =>
            a.id === id ? { ...a, saving: false, reviewStatus: 'accepted' as ReviewStatus } : a,
          );
          if (next.every((a) => a.reviewStatus !== 'pending')) {
            setTimeout(() => onComplete(), 0);
          }
          return next;
        });
      } catch {
        updateAtom(id, { saving: false, error: 'Network error' });
      }
    },
    [tenantSlug, updateAtom, onComplete],
  );

  // ---- Reject single atom ----
  const rejectAtom = useCallback(
    async (id: string) => {
      updateAtom(id, { saving: true, error: null });

      try {
        const res = await fetch(
          `/api/portal/${tenantSlug}/library/${id}`,
          { method: 'DELETE' },
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Request failed' }));
          updateAtom(id, { saving: false, error: data.error ?? 'Reject failed' });
          return;
        }

        setAtomStates((prev) => {
          const next = prev.map((a) =>
            a.id === id ? { ...a, saving: false, reviewStatus: 'rejected' as ReviewStatus } : a,
          );
          if (next.every((a) => a.reviewStatus !== 'pending')) {
            setTimeout(() => onComplete(), 0);
          }
          return next;
        });
      } catch {
        updateAtom(id, { saving: false, error: 'Network error' });
      }
    },
    [tenantSlug, updateAtom, onComplete],
  );

  // ---- Accept all pending atoms ----
  const acceptAll = useCallback(async () => {
    const pending = atomStates.filter((a) => a.reviewStatus === 'pending');
    for (const atom of pending) {
      await acceptAtom(atom.id);
    }
  }, [atomStates, acceptAtom]);

  // ---- Set category for all visible (pending) atoms ----
  const setCategoryForAll = useCallback(
    (cat: string) => {
      if (!cat) return;
      setAtomStates((prev) =>
        prev.map((a) =>
          a.reviewStatus === 'pending' ? { ...a, category: cat } : a,
        ),
      );
      setBulkCategory('');
    },
    [],
  );

  // ---- Local updates for category / tags ----
  const setCategory = useCallback(
    (id: string, category: string) => updateAtom(id, { category }),
    [updateAtom],
  );

  const setTags = useCallback(
    (id: string, tagString: string) => {
      const tags = tagString
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      updateAtom(id, { tags });
    },
    [updateAtom],
  );

  const toggleExpand = useCallback(
    (id: string) => {
      setAtomStates((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, expanded: !a.expanded } : a,
        ),
      );
    },
    [],
  );

  const markForSplit = useCallback(
    (id: string) => {
      setAtomStates((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, markedForSplit: !a.markedForSplit } : a,
        ),
      );
    },
    [],
  );

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Review Atoms</h1>
        <div className="mt-1 text-sm text-gray-500 space-y-0.5">
          <p>
            Source: <span className="font-medium text-gray-700">{sourceFilename}</span>
          </p>
          {documentMetadata?.title && (
            <p>Title: {documentMetadata.title}</p>
          )}
          {documentMetadata?.author && (
            <p>Author: {documentMetadata.author}</p>
          )}
          {documentMetadata?.pageCount != null && (
            <p>Pages: {documentMetadata.pageCount}</p>
          )}
          <p>{total} atom{total !== 1 ? 's' : ''} extracted</p>
        </div>
      </div>

      {/* Bulk actions bar */}
      <div className="flex items-center gap-4 mb-6 p-3 bg-gray-50 border border-gray-200 rounded-lg">
        <button
          type="button"
          onClick={acceptAll}
          className="px-3 py-1.5 text-sm font-medium rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          disabled={reviewed === total}
        >
          Accept All
        </button>

        <div className="flex items-center gap-2">
          <select
            value={bulkCategory}
            onChange={(e) => setBulkCategory(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1.5"
          >
            <option value="">Set category for all...</option>
            {CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setCategoryForAll(bulkCategory)}
            disabled={!bulkCategory}
            className="px-3 py-1.5 text-sm font-medium rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Apply
          </button>
        </div>

        <span className="ml-auto text-sm text-gray-500">
          {reviewed} of {total} atom{total !== 1 ? 's' : ''} reviewed
        </span>
      </div>

      {/* Atom cards */}
      <div className="space-y-3">
        {atomStates.map((atom) => (
          <AtomCard
            key={atom.id}
            atom={atom}
            onAccept={acceptAtom}
            onReject={rejectAtom}
            onSetCategory={setCategory}
            onSetTags={setTags}
            onToggleExpand={toggleExpand}
            onMarkForSplit={markForSplit}
          />
        ))}
      </div>
    </div>
  );
}

// ---- Atom Card ----

function AtomCard({
  atom,
  onAccept,
  onReject,
  onSetCategory,
  onSetTags,
  onToggleExpand,
  onMarkForSplit,
}: {
  atom: AtomState;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onSetCategory: (id: string, cat: string) => void;
  onSetTags: (id: string, tags: string) => void;
  onToggleExpand: (id: string) => void;
  onMarkForSplit: (id: string) => void;
}) {
  const bgClass =
    atom.reviewStatus === 'accepted'
      ? 'bg-green-50 border-green-200'
      : atom.reviewStatus === 'rejected'
        ? 'bg-red-50 border-red-200'
        : 'bg-white border-gray-200';

  const confidenceClass =
    atom.confidence > 0.7
      ? 'bg-green-100 text-green-700'
      : atom.confidence > 0.4
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-red-100 text-red-700';

  const contentPreview =
    atom.content.length > 300 && !atom.expanded
      ? atom.content.slice(0, 300) + '...'
      : atom.content;

  // Collapsed view for rejected atoms
  if (atom.reviewStatus === 'rejected') {
    return (
      <div className={`border rounded-lg p-3 ${bgClass}`}>
        <div className="flex items-center gap-2">
          <span className="text-red-400 text-xs font-medium">REJECTED</span>
          <span className="text-sm text-gray-400 line-through truncate">
            {atom.headingText ?? atom.content.slice(0, 80)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={`border rounded-lg p-4 ${bgClass}`}>
      {/* Card header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {atom.reviewStatus === 'accepted' && (
            <svg
              className="w-5 h-5 text-green-600 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          )}
          {atom.headingText ? (
            <h3 className="text-sm font-semibold text-gray-800 truncate">
              {atom.headingText}
            </h3>
          ) : (
            <h3 className="text-sm font-medium text-gray-400 italic truncate">
              No heading
            </h3>
          )}
        </div>
        <span
          className={`flex-shrink-0 text-xs font-medium px-2 py-0.5 rounded ${confidenceClass}`}
        >
          {Math.round(atom.confidence * 100)}%
        </span>
      </div>

      {/* Content */}
      <div className="mb-3">
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{contentPreview}</p>
        {atom.content.length > 300 && (
          <button
            type="button"
            onClick={() => onToggleExpand(atom.id)}
            className="text-xs text-blue-600 hover:underline mt-1"
          >
            {atom.expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {/* Category + Tags (editable only for pending atoms) */}
      {atom.reviewStatus === 'pending' ? (
        <div className="flex flex-wrap gap-3 mb-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Category</label>
            <select
              value={atom.category}
              onChange={(e) => onSetCategory(atom.id, e.target.value)}
              className="text-sm border border-gray-300 rounded px-2 py-1"
            >
              {CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat.replace(/_/g, ' ')}
                </option>
              ))}
              {/* If the current category isn't in CATEGORIES, show it too */}
              {!CATEGORIES.includes(atom.category as typeof CATEGORIES[number]) && (
                <option value={atom.category}>{atom.category}</option>
              )}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">
              Tags (comma-separated)
            </label>
            <div className="flex items-center gap-1 flex-wrap">
              {atom.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600"
                >
                  {tag}
                </span>
              ))}
            </div>
            <input
              type="text"
              defaultValue={atom.tags.join(', ')}
              onBlur={(e) => onSetTags(atom.id, e.target.value)}
              className="mt-1 w-full text-sm border border-gray-300 rounded px-2 py-1"
              placeholder="tag1, tag2, tag3"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">
            {atom.category.replace(/_/g, ' ')}
          </span>
          {atom.tags.map((tag) => (
            <span
              key={tag}
              className="inline-block px-1.5 py-0.5 rounded text-xs bg-blue-50 text-blue-600"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Split flag */}
      {atom.markedForSplit && (
        <p className="text-xs text-amber-600 mb-2">
          Marked for re-splitting
        </p>
      )}

      {/* Error */}
      {atom.error && (
        <p className="text-xs text-red-600 mb-2">{atom.error}</p>
      )}

      {/* Action buttons */}
      {atom.reviewStatus === 'pending' && (
        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={() => onAccept(atom.id)}
            disabled={atom.saving}
            className="px-3 py-1 text-sm font-medium rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {atom.saving ? 'Saving...' : 'Accept'}
          </button>
          <button
            type="button"
            onClick={() => onReject(atom.id)}
            disabled={atom.saving}
            className="px-3 py-1 text-sm font-medium rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => onMarkForSplit(atom.id)}
            disabled={atom.saving}
            className={`px-3 py-1 text-sm font-medium rounded border ${
              atom.markedForSplit
                ? 'border-amber-400 bg-amber-50 text-amber-700'
                : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            Split
          </button>
        </div>
      )}

      {atom.reviewStatus === 'accepted' && (
        <div className="pt-2 border-t border-green-100">
          <span className="text-xs text-green-600 font-medium">Accepted</span>
        </div>
      )}
    </div>
  );
}
