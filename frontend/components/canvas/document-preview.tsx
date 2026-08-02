'use client';

/**
 * DocumentPreview — "see it as it will download."
 *
 * A full-screen overlay that renders the proposal exactly the way the export does, in a
 * sandboxed iframe (no scripts — static HTML only). Two scopes:
 *   • Section       — the CURRENT section, rendered client-side from the live in-memory doc
 *                     (so it reflects unsaved edits). Instant, no server round-trip.
 *   • Full document — the WHOLE proposal assembled from all SAVED sections, fetched from the
 *                     gated /preview endpoint (admin OR a collaborator with a grant).
 *
 * Both use the same pure renderCanvasPreviewHtml (lib/export/canvas-html) → identical look.
 * Fidelity: this is the print/PDF layout (exact for the .pdf; a very close match for the
 * .docx, which Word may reflow slightly). The Export buttons remain the source of the file.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { renderCanvasPreviewHtml } from '@/lib/export/canvas-html';

type Mode = 'section' | 'foundation';

interface Props {
  doc: CanvasDocument;
  proposalId?: string;
  tenantSlug?: string;
  /** Section title, shown in the header. */
  title?: string;
  initialMode?: Mode;
  onClose: () => void;
}

export function DocumentPreview({ doc, proposalId, tenantSlug, title, initialMode = 'section', onClose }: Props) {
  const canPreviewFoundation = Boolean(proposalId && tenantSlug);
  const [mode, setMode] = useState<Mode>(initialMode === 'foundation' && canPreviewFoundation ? 'foundation' : 'section');
  const [fullHtml, setFullHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Section preview: pure, client-side, reflects live (unsaved) edits.
  const sectionHtml = useMemo(() => renderCanvasPreviewHtml(doc), [doc]);

  // Full-document preview: fetch the server-assembled HTML once, lazily.
  useEffect(() => {
    if (mode !== 'foundation' || !canPreviewFoundation || fullHtml !== null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/preview`)
      .then(async (res) => {
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || `Preview failed (${res.status})`);
        }
        return res.json();
      })
      .then((j) => { if (!cancelled) setFullHtml(String(j?.data?.html ?? '')); })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Preview failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [mode, canPreviewFoundation, fullHtml, tenantSlug, proposalId]);

  // Esc to close.
  const onKey = useCallback((e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }, [onClose]);
  useEffect(() => { window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onKey]);

  const srcDoc = mode === 'section' ? sectionHtml : (fullHtml ?? '');

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60" role="dialog" aria-modal="true" aria-label="Document preview">
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-100">
        <span className="font-medium">Preview</span>
        <div className="flex overflow-hidden rounded-md border border-gray-600">
          <button
            onClick={() => setMode('section')}
            className={`px-3 py-1 text-xs ${mode === 'section' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
          >
            This section
          </button>
          <button
            onClick={() => setMode('foundation')}
            disabled={!canPreviewFoundation}
            title={canPreviewFoundation ? 'Preview the whole assembled proposal' : 'Open from a proposal to preview the full document'}
            className={`px-3 py-1 text-xs ${mode === 'foundation' ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'} disabled:cursor-not-allowed disabled:opacity-40`}
          >
            Full document
          </button>
        </div>
        {title && <span className="truncate text-xs text-gray-400">{title}</span>}
        <span className="ml-auto text-xs text-gray-400">Print / PDF layout — the .docx you download matches this content.</span>
        <button onClick={onClose} className="rounded bg-gray-700 px-3 py-1 text-xs font-medium hover:bg-gray-600" aria-label="Close preview">
          Close ✕
        </button>
      </div>

      {/* Preview surface */}
      <div className="relative flex-1 overflow-hidden bg-gray-600">
        {mode === 'foundation' && loading && (
          <div className="flex h-full items-center justify-center text-sm text-gray-200">Assembling the full document…</div>
        )}
        {mode === 'foundation' && error && (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-rose-200">
            {error}
          </div>
        )}
        {!(mode === 'foundation' && (loading || error)) && (
          <iframe
            title="document-preview"
            className="h-full w-full border-0 bg-gray-600"
            sandbox=""
            srcDoc={srcDoc}
          />
        )}
      </div>
    </div>
  );
}
