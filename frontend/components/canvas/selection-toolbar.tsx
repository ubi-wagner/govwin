'use client';

/**
 * SelectionToolbar — the "selection is the verb" floating menu (fluid-canvas F0).
 *
 * Watches for a live text selection inside the canvas, reads it back to the document
 * model (selectionToModel over the [data-node-id] anchors), and floats a compact
 * toolbar at the selection with the actions the host wires in: Atomize (save the span
 * as a reusable library atom), Regenerate (AI re-draft the spanned nodes), Annotate.
 * The actions are callbacks — this component owns only the selection reading + placement.
 */
import { useEffect, useState, useCallback } from 'react';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { selectionToModel, type CanvasSelection } from '@/lib/canvas/selection';

interface Props {
  doc: CanvasDocument;
  onAtomize?: (sel: CanvasSelection) => void;
  onRegenerate?: (sel: CanvasSelection) => void;
  onAnnotate?: (sel: CanvasSelection) => void;
  onReuse?: (sel: CanvasSelection) => void;
  onComplianceCheck?: (sel: CanvasSelection) => void;
  /** Suppress the toolbar (e.g. read-only, or a modal is open). */
  disabled?: boolean;
  /** Optional busy flag — shows a spinner label instead of the actions. */
  busy?: boolean;
}

const elementOf = (node: Node | null): Element | null =>
  !node ? null : node.nodeType === Node.TEXT_NODE ? (node as Text).parentElement : (node as Element);

export function SelectionToolbar({ doc, onAtomize, onRegenerate, onAnnotate, onReuse, onComplianceCheck, disabled, busy }: Props) {
  const [sel, setSel] = useState<CanvasSelection | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const refresh = useCallback(() => {
    if (disabled) { setSel(null); setPos(null); return; }
    const s = window.getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0 || !s.toString().trim()) { setSel(null); setPos(null); return; }
    const range = s.getRangeAt(0);
    const startEl = elementOf(range.startContainer)?.closest('[data-node-id]') as HTMLElement | null;
    const endEl = elementOf(range.endContainer)?.closest('[data-node-id]') as HTMLElement | null;
    if (!startEl?.dataset.nodeId || !endEl?.dataset.nodeId) { setSel(null); setPos(null); return; }
    const model = selectionToModel(doc, startEl.dataset.nodeId, endEl.dataset.nodeId);
    if (!model || !model.text.trim()) { setSel(null); setPos(null); return; }
    const rect = range.getBoundingClientRect();
    setSel(model);
    setPos({ top: Math.max(8, rect.top - 46), left: rect.left + rect.width / 2 });
  }, [doc, disabled]);

  useEffect(() => {
    document.addEventListener('selectionchange', refresh);
    document.addEventListener('mouseup', refresh);
    window.addEventListener('scroll', refresh, true);
    return () => {
      document.removeEventListener('selectionchange', refresh);
      document.removeEventListener('mouseup', refresh);
      window.removeEventListener('scroll', refresh, true);
    };
  }, [refresh]);

  if (!sel || !pos) return null;

  const spanLabel = `${sel.nodeIds.length} block${sel.nodeIds.length > 1 ? 's' : ''}`
    + (sel.groupTitles.length > 1 ? ` · ${sel.groupTitles.length} sections` : '');

  return (
    <div
      style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)', zIndex: 60 }}
      className="flex items-center gap-0.5 rounded-lg bg-slate-900 text-white shadow-xl px-1.5 py-1 text-xs select-none"
      onMouseDown={(e) => e.preventDefault()}  /* keep the selection alive when clicking the toolbar */
    >
      {busy ? (
        <span className="px-2 py-1 text-slate-300">Working…</span>
      ) : (
        <>
          <span className="px-1.5 text-slate-400 tabular-nums">{spanLabel}</span>
          <div className="w-px h-4 bg-slate-700 mx-0.5" />
          {onAtomize && (
            <button onClick={() => onAtomize(sel)} className="px-2 py-1 rounded hover:bg-slate-700" title="Save this selection as a reusable library atom (with lineage)">⬡ Atomize</button>
          )}
          {onRegenerate && (
            <button onClick={() => onRegenerate(sel)} className="px-2 py-1 rounded hover:bg-slate-700" title="Regenerate the selected block(s) with AI">↻ Regenerate</button>
          )}
          {onAnnotate && (
            <button onClick={() => onAnnotate(sel)} className="px-2 py-1 rounded hover:bg-slate-700" title="Add a note to this selection">✎ Annotate</button>
          )}
          {onReuse && (
            <button onClick={() => onReuse(sel)} className="px-2 py-1 rounded hover:bg-slate-700" title="Find a reusable library atom for this section">⇄ Reuse</button>
          )}
          {onComplianceCheck && (
            <button onClick={() => onComplianceCheck(sel)} className="px-2 py-1 rounded hover:bg-slate-700" title="Check this section against the solicitation's compliance requirements">✓ Compliance</button>
          )}
        </>
      )}
    </div>
  );
}
