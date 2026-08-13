'use client';

/**
 * FluidDocumentView — the whole proposal rendered as ONE continuous, fluid document
 * (fluid-canvas F1). Instead of the section-by-section "cocoon" cards, every section's
 * canvas is concatenated (see `assembleProposalDocument`) and rendered inline as a single
 * document, with:
 *   - a left **outline rail** (click-to-scroll + active-section-on-scroll),
 *   - each section introduced by its inline title heading (the fluid "boundary"),
 *   - the F0 **selection toolbar**: highlight any span (across sections) → **Atomize** it
 *     into a reusable library atom, routed to the span's OWNING section via `sectionOf`.
 *
 * Read-only over the aggregate (no in-place editing here — that stays in the per-section
 * editor); the selection action is additive/safe (atomize), honoring the agent-safety
 * invariant that nothing auto-writes a business table. Regenerate/annotate/compliance over
 * a span land in F2 (they need the aggregate review-and-land flow).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CanvasRenderer } from './canvas-renderer';
import { SelectionToolbar } from './selection-toolbar';
import { CanvasOverlayBar, overlayClass, useOverlays } from './canvas-overlays';
import { selectionLabel, type CanvasSelection } from '@/lib/canvas/selection';
import type { AssembledProposal } from '@/lib/canvas/assemble-proposal';
import { toast } from '@/lib/toast';

interface Props {
  assembled: AssembledProposal;
  tenantSlug: string;
  proposalId: string;
  variables?: Record<string, string>;
  /** When false the selection toolbar is suppressed (pure view). Defaults on. */
  canAct?: boolean;
}

/** A safe `[data-node-id=…]` selector for an id that may carry `:` / `__`. */
const anchorSel = (id: string) =>
  `[data-node-id=${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : `"${id.replace(/["\\]/g, '\\$&')}"`}]`;

/** Recover the in-section node id from an assembled id (`${sectionId}__${nodeId}`). */
const originalNodeId = (assembledId: string, sectionId: string) =>
  assembledId.startsWith(`${sectionId}__`) ? assembledId.slice(sectionId.length + 2) : assembledId;

export function FluidDocumentView({ assembled, tenantSlug, proposalId, variables, canAct = true }: Props) {
  const { doc, sectionOf, outline } = assembled;
  const [activeSection, setActiveSection] = useState<string | null>(outline[0]?.sectionId ?? null);
  const [selBusy, setSelBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Structure-as-overlay (Phase 1): togglable dotted Sections / Atoms / Provenance layers,
  // off by default → a clean document until a chip is summoned. See canvas-overlays.tsx.
  const { active: overlays, toggle: toggleOverlay } = useOverlays();

  // Active-section-on-scroll: observe the inline section-title anchors and light up the
  // topmost one currently in the reading band.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const anchors = outline
      .map((o) => root.querySelector(anchorSel(o.anchorNodeId)))
      .filter((el): el is Element => !!el);
    if (!anchors.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const top = visible[0]?.target as HTMLElement | undefined;
        const id = top?.dataset.nodeId;
        const o = id ? outline.find((x) => x.anchorNodeId === id) : undefined;
        if (o) setActiveSection(o.sectionId);
      },
      { rootMargin: '-8% 0px -78% 0px', threshold: 0 },
    );
    anchors.forEach((a) => io.observe(a));
    return () => io.disconnect();
  }, [outline]);

  const scrollTo = useCallback((anchorNodeId: string, sectionId: string) => {
    setActiveSection(sectionId);
    containerRef.current?.querySelector(anchorSel(anchorNodeId))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const selectionAtomize = useCallback(
    async (sel: CanvasSelection) => {
      const text = sel.text.trim();
      if (text.length < 20) { toast.info('Select a bit more text to atomize (≥ 20 characters).'); return; }
      const owner = sectionOf[sel.nodeIds[0]];
      if (!owner) { toast.error('Could not resolve the section for this selection.'); return; }
      setSelBusy(true);
      try {
        const res = await fetch(
          `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${owner.id}/atomize-node`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nodeId: originalNodeId(sel.nodeIds[0], owner.id),
              heading: selectionLabel(sel) || owner.title,
              text,
              tags: [],
            }),
          },
        );
        const j = await res.json().catch(() => ({}));
        if (res.ok) {
          toast.success(j?.data?.deduped ? `Matched an existing atom (from “${owner.title}”).` : `Saved as a library atom (from “${owner.title}”).`);
        } else {
          toast.error(j?.error ?? 'Could not atomize the selection.');
        }
      } catch {
        toast.error('Could not atomize the selection.');
      } finally {
        setSelBusy(false);
        window.getSelection()?.removeAllRanges();
      }
    },
    [sectionOf, tenantSlug, proposalId],
  );

  const selectionAnnotate = useCallback(
    async (sel: CanvasSelection) => {
      const owner = sectionOf[sel.nodeIds[0]];
      if (!owner) { toast.error('Could not resolve the section for this selection.'); return; }
      const note = typeof window !== 'undefined' ? window.prompt(`Add a note on “${selectionLabel(sel)}”:`) : null;
      if (!note || !note.trim()) return;
      const snippet = sel.text.slice(0, 140) + (sel.text.length > 140 ? '…' : '');
      setSelBusy(true);
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: owner.id, text: `“${snippet}” — ${note.trim()}` }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok) toast.success(`Note added to “${owner.title}”.`);
        else toast.error(j?.error ?? 'Could not add the note.');
      } catch {
        toast.error('Could not add the note.');
      } finally {
        setSelBusy(false);
        window.getSelection()?.removeAllRanges();
      }
    },
    [sectionOf, tenantSlug, proposalId],
  );

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Overlay chips — summon the dotted section / atom-primitive / provenance layers. */}
      <CanvasOverlayBar active={overlays} onToggle={toggleOverlay} className="shrink-0 px-1" />
      <div className="flex gap-4 flex-1 min-h-0">
      {/* Outline rail */}
      <nav className="hidden md:block w-56 shrink-0 self-start sticky top-2 max-h-[calc(100vh-1rem)] overflow-y-auto py-3 pr-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 px-2">Document outline</div>
        <ul className="space-y-0.5">
          {outline.map((o, i) => {
            const active = activeSection === o.sectionId;
            const newVolume = i === 0 || outline[i - 1].volumeName !== o.volumeName;
            return (
              <li key={o.sectionId}>
                {newVolume && o.volumeName && (
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mt-3 mb-1 px-2 truncate">{o.volumeName}</div>
                )}
                <button
                  onClick={() => scrollTo(o.anchorNodeId, o.sectionId)}
                  className={`w-full text-left text-sm rounded px-2 py-1 truncate transition-colors border-l-2 ${
                    active
                      ? 'bg-blue-50 text-blue-700 font-medium border-blue-500'
                      : 'text-gray-600 hover:bg-gray-50 border-transparent'
                  }`}
                  title={o.title}
                >
                  {o.title}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* The continuous document. userSelect:text guarantees the read-only render is still
          selectable regardless of any ancestor `select-none` (the per-node readOnly path
          leaves user-select unset, i.e. inherit — this wrapper supplies it). */}
      <div ref={containerRef} className={`flex-1 min-w-0 overflow-y-auto ${overlayClass(overlays)}`} style={{ userSelect: 'text' }}>
        <CanvasRenderer
          document={doc}
          selectedNodeId={null}
          onSelectNode={() => {}}
          onUpdateNode={() => {}}
          variables={variables}
          readOnly
        />
        {canAct && <SelectionToolbar doc={doc} busy={selBusy} onAtomize={selectionAtomize} onAnnotate={selectionAnnotate} />}
      </div>
      </div>
    </div>
  );
}
