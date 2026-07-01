'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AtomBubbleRail, type AtomBubble } from '@/components/atomization/atom-bubble-rail';

/**
 * The atomization surface: the uploaded document on the LEFT, the AtomBubbleRail on
 * the RIGHT. Each extracted atom is a click-open bubble — classify its section type,
 * add multiple side tags, and accept it into the library, one frictionless click at a
 * time. This is the reusable rail mounted for real, and it serves ANY upload (the
 * library upload → atomize flow lands every document here) and, soon, agent-populated
 * bubbles (the rail is pure UI over the same atom model).
 *
 * Classify persists immediately (subcategory = the standard's bucket + a `type:<key>`
 * tag); Accept flips status to approved; tags round-trip through the library PATCH.
 */

interface StandardOption {
  key: string;
  label: string;
  category: string | null;
}

interface InputAtom {
  id: string;
  content: string;
  category: string;
  tags: string[];
  headingText: string | null;
  confidence: number;
}

interface RowState {
  id: string;
  content: string;
  heading: string | null;
  confidence: number;
  subcategory: string | null;
  sectionType: string | null;
  tags: string[];
  status: 'draft' | 'approved';
}

interface AtomizeRailReviewProps {
  tenantSlug: string;
  redirectTo: string;
  sourceFilename: string;
  documentMetadata?: { title?: string; author?: string; pageCount?: number };
  standards: StandardOption[];
  atoms: InputAtom[];
}

/** The `type:<key>` tag encodes the classified section type; derive it back on load. */
function typeFromTags(tags: string[]): string | null {
  const t = tags.find((x) => x.startsWith('type:'));
  return t ? t.slice('type:'.length) : null;
}

export default function AtomizeRailReview({
  tenantSlug,
  redirectTo,
  sourceFilename,
  documentMetadata,
  standards,
  atoms,
}: AtomizeRailReviewProps) {
  const router = useRouter();

  const [rows, setRows] = useState<RowState[]>(() =>
    atoms.map((a) => ({
      id: a.id,
      content: a.content,
      heading: a.headingText,
      confidence: a.confidence,
      subcategory: null,
      sectionType: typeFromTags(a.tags),
      tags: a.tags,
      status: 'draft',
    })),
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const standardsForRail = useMemo(
    () => standards.map((s) => ({ key: s.key, label: s.label })),
    [standards],
  );

  const accepted = rows.filter((r) => r.status === 'approved').length;

  const patchUnit = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<boolean> => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/library/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [tenantSlug],
  );

  const patchRow = useCallback(
    (id: string, updates: Partial<RowState>) =>
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r))),
    [],
  );

  // ── Classify: set the section type (persists subcategory bucket + type: tag) ──
  const onClassify = useCallback(
    async (id: string, key: string) => {
      const std = standards.find((s) => s.key === key);
      setBusyId(id);
      let nextTags: string[] = [];
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          nextTags = [...r.tags.filter((t) => !t.startsWith('type:')), `type:${key}`];
          return { ...r, sectionType: key, subcategory: std?.category ?? r.subcategory, tags: nextTags };
        }),
      );
      await patchUnit(id, { subcategory: std?.category ?? '', tags: nextTags });
      setBusyId(null);
    },
    [standards, patchUnit],
  );

  // ── Accept: flip to approved (subcategory/tags already saved) ──
  const onAccept = useCallback(
    async (id: string) => {
      setBusyId(id);
      const ok = await patchUnit(id, { status: 'approved' });
      setBusyId(null);
      if (ok) {
        patchRow(id, { status: 'approved' });
        setRows((prev) => {
          if (prev.every((r) => r.status === 'approved')) {
            setTimeout(() => router.push(redirectTo), 500);
          }
          return prev;
        });
      }
    },
    [patchUnit, patchRow, router, redirectTo],
  );

  const onAcceptAll = useCallback(async () => {
    const pending = rows.filter((r) => r.status !== 'approved');
    for (const r of pending) {
      // eslint-disable-next-line no-await-in-loop
      await onAccept(r.id);
    }
  }, [rows, onAccept]);

  // ── Multiple side tags — accumulate as the atom moves into the library ──
  const onAddTag = useCallback(
    async (id: string, tag: string) => {
      const clean = tag.trim();
      if (!clean) return;
      let nextTags: string[] = [];
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          nextTags = r.tags.includes(clean) ? r.tags : [...r.tags, clean];
          return { ...r, tags: nextTags };
        }),
      );
      await patchUnit(id, { tags: nextTags });
    },
    [patchUnit],
  );

  const onRemoveTag = useCallback(
    async (id: string, tag: string) => {
      let nextTags: string[] = [];
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          nextTags = r.tags.filter((t) => t !== tag);
          return { ...r, tags: nextTags };
        }),
      );
      await patchUnit(id, { tags: nextTags });
    },
    [patchUnit],
  );

  const onBubbleClick = useCallback((id: string) => {
    setActiveId(id);
    if (typeof document !== 'undefined') {
      document.getElementById(`doc-atom-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const railItems: AtomBubble[] = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        heading: r.heading || r.content.slice(0, 60),
        snippet: r.content.slice(0, 180),
        nodeType: 'text_block',
        suggestedType: r.sectionType,
        sectionType: r.sectionType,
        tags: r.tags,
        status: r.status,
      })),
    [rows],
  );

  return (
    <div className="flex gap-0 border border-gray-200 rounded-xl overflow-hidden bg-white" style={{ minHeight: '70vh' }}>
      {/* ── Document panel (left) ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="px-5 py-3 border-b border-gray-200 bg-gray-50">
          <h2 className="text-sm font-semibold text-gray-800 truncate">{sourceFilename}</h2>
          <p className="text-[11px] text-gray-500">
            {documentMetadata?.title ? `${documentMetadata.title} · ` : ''}
            {rows.length} atoms · {accepted} accepted
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {rows.map((r) => (
            <div
              key={r.id}
              id={`doc-atom-${r.id}`}
              onClick={() => setActiveId(r.id)}
              className={`rounded-lg border p-3 cursor-pointer transition-colors ${
                activeId === r.id
                  ? 'border-blue-400 bg-blue-50'
                  : r.status === 'approved'
                    ? 'border-green-200 bg-green-50/40'
                    : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                {r.status === 'approved' && (
                  <svg className="w-4 h-4 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                <span className="text-xs font-semibold text-gray-700 truncate">
                  {r.heading || 'Untitled section'}
                </span>
                {r.sectionType && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-50 text-indigo-600">
                    {standards.find((s) => s.key === r.sectionType)?.label ?? r.sectionType}
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-600 whitespace-pre-wrap line-clamp-4">{r.content}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Atomization rail (right) ── */}
      <AtomBubbleRail
        title="Atoms"
        items={railItems}
        standards={standardsForRail}
        onClassify={onClassify}
        onAccept={onAccept}
        onAcceptAll={onAcceptAll}
        onAddTag={onAddTag}
        onRemoveTag={onRemoveTag}
        onBubbleClick={onBubbleClick}
        busyId={busyId}
        emptyText="No atoms extracted — upload a document to atomize."
      />
    </div>
  );
}
