'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AtomBubbleRail, type AtomBubble } from '@/components/atomization/atom-bubble-rail';
import { coerceJsonb } from '@/lib/jsonb';

/**
 * The same atomization rail, mounted on the admin RFP-curation surface as a
 * toggleable right drawer. The "atoms" here are the annotations the admin has drawn
 * on the solicitation (highlights / boxes) — each becomes a bubble the admin can
 * classify (section type), tag, and accept as a section anchor for downstream
 * matching. Classify/tag/accept persist into the annotation's payload via PATCH.
 *
 * Self-contained (own fetch + state) so it drops onto the large curation workspace
 * with a single mount line and no layout refactor. Reads are coerced (tolerant of
 * the legacy JSON.stringify::jsonb string form of payload/source_location).
 */

interface AnnotationAtomizeRailProps {
  solId: string;
}

interface RawAnnotation {
  id: string;
  kind: string;
  sourceLocation: unknown;
  payload: unknown;
  complianceVariableName?: string | null;
}

interface AnnRow {
  id: string;
  heading: string;
  snippet: string;
  page: number | null;
  sectionType: string | null;
  tags: string[];
  status: 'draft' | 'approved';
}

interface SourceLocationShape {
  page?: number;
  excerpt?: string;
  section_title?: string;
}
interface PayloadShape {
  excerpt?: string;
  sectionType?: string | null;
  tags?: string[];
  status?: string;
}

function toRow(a: RawAnnotation): AnnRow {
  const loc = coerceJsonb<SourceLocationShape>(a.sourceLocation, {});
  const pl = coerceJsonb<PayloadShape>(a.payload, {});
  const excerpt = pl.excerpt || loc.excerpt || '';
  const heading = loc.section_title || excerpt.slice(0, 60) || `${a.kind.replace('_', ' ')}`;
  return {
    id: a.id,
    heading,
    snippet: excerpt.slice(0, 180),
    page: typeof loc.page === 'number' ? loc.page : null,
    sectionType: pl.sectionType ?? null,
    tags: Array.isArray(pl.tags) ? pl.tags : [],
    status: pl.status === 'approved' ? 'approved' : 'draft',
  };
}

export default function AnnotationAtomizeRail({ solId }: AnnotationAtomizeRailProps) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<AnnRow[]>([]);
  const [standards, setStandards] = useState<Array<{ key: string; label: string }>>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Load annotations + the section-standards vocabulary once the drawer is first opened.
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    (async () => {
      try {
        const [aRes, sRes] = await Promise.all([
          fetch(`/api/admin/rfp-curation/${solId}/annotations`),
          fetch(`/api/admin/section-standards`),
        ]);
        if (aRes.ok) {
          const body = await aRes.json();
          const anns: RawAnnotation[] = body.data?.annotations ?? [];
          if (!cancelled) setRows(anns.map(toRow));
        }
        if (sRes.ok) {
          const body = await sRes.json();
          const rowsS: Array<{ key: string; label: string }> = body.data?.standards ?? [];
          if (!cancelled) setStandards(rowsS.map((s) => ({ key: s.key, label: s.label })));
        }
      } catch {
        // non-critical
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, loaded, solId]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>): Promise<boolean> => {
      try {
        const res = await fetch(`/api/admin/rfp-curation/${solId}/annotations/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
    [solId],
  );

  const setRow = useCallback(
    (id: string, updates: Partial<AnnRow>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r))),
    [],
  );

  const onClassify = useCallback(
    async (id: string, key: string) => {
      setBusyId(id);
      setRow(id, { sectionType: key });
      await patch(id, { sectionType: key });
      setBusyId(null);
    },
    [patch, setRow],
  );

  const onAccept = useCallback(
    async (id: string) => {
      setBusyId(id);
      const ok = await patch(id, { status: 'approved' });
      if (ok) setRow(id, { status: 'approved' });
      setBusyId(null);
    },
    [patch, setRow],
  );

  const onAcceptAll = useCallback(async () => {
    const pending = rows.filter((r) => r.status !== 'approved');
    for (const r of pending) {
      // eslint-disable-next-line no-await-in-loop
      await onAccept(r.id);
    }
  }, [rows, onAccept]);

  const onAddTag = useCallback(
    async (id: string, tag: string) => {
      const clean = tag.trim();
      if (!clean) return;
      let next: string[] = [];
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          next = r.tags.includes(clean) ? r.tags : [...r.tags, clean];
          return { ...r, tags: next };
        }),
      );
      await patch(id, { tags: next });
    },
    [patch],
  );

  const onRemoveTag = useCallback(
    async (id: string, tag: string) => {
      let next: string[] = [];
      setRows((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          next = r.tags.filter((t) => t !== tag);
          return { ...r, tags: next };
        }),
      );
      await patch(id, { tags: next });
    },
    [patch],
  );

  const items: AtomBubble[] = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        heading: r.heading || 'Annotation',
        snippet: r.snippet,
        page: r.page,
        nodeType: 'text_block',
        suggestedType: r.sectionType,
        sectionType: r.sectionType,
        tags: r.tags,
        status: r.status,
      })),
    [rows],
  );

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`fixed right-4 bottom-4 z-40 flex items-center gap-2 px-4 py-2 rounded-full shadow-lg text-sm font-medium ${
          open ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'
        }`}
        title="Classify, tag & accept annotations as section anchors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
        </svg>
        Section Rail{rows.length > 0 ? ` (${rows.length})` : ''}
      </button>

      {open && (
        <div className="fixed inset-y-0 right-0 z-40 shadow-2xl">
          <div className="relative h-full">
            <button
              onClick={() => setOpen(false)}
              className="absolute top-2.5 right-2 z-10 text-gray-400 hover:text-gray-700 text-lg leading-none"
              aria-label="Close section rail"
            >
              ✕
            </button>
            <AtomBubbleRail
              title="Section anchors"
              items={items}
              standards={standards}
              onClassify={onClassify}
              onAccept={onAccept}
              onAcceptAll={onAcceptAll}
              onAddTag={onAddTag}
              onRemoveTag={onRemoveTag}
              busyId={busyId}
              emptyText={loaded ? 'No annotations yet — highlight sections on the RFP to atomize.' : 'Loading annotations…'}
              className="h-full"
            />
          </div>
        </div>
      )}
    </>
  );
}
