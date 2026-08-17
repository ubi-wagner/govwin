'use client';

/**
 * FluidDocumentView — the whole proposal as ONE continuous, EDITABLE fluid document
 * (fluid-canvas F1 read view → F2 editable one-canvas). Every section's canvas is concatenated
 * (see `assembleProposalDocument`) and rendered inline as a single document, with:
 *   - a left **outline rail** (click-to-scroll + active-section-on-scroll + per-section status),
 *   - each section introduced by its inline title heading (the fluid "boundary"),
 *   - the F0 **selection toolbar**: highlight any span → **Atomize** / **Annotate** it, routed to
 *     the span's OWNING section via `sectionOf`,
 *   - **in-place editing (F2):** click a node in an editable section to edit it inline; edits patch
 *     the assembled display doc and mark the OWNING section dirty. Save reconstructs each dirty
 *     section's own flat doc (assembled nodes filtered to the section, un-prefixed, wrapped in the
 *     section's own frame) and PUTs it through the per-section save route — which owns the fragile
 *     canvas_versions CAS numbering + lock/stage/access enforcement. Nothing here writes a business
 *     table directly; a locked / prior-stage / unassigned section is not selectable (editable=false).
 *
 * Agent-safety + invariants (see docs/CANVAS_ARCHITECTURE.md §3/§7, save/route.ts):
 *   - synthetic `sec:<id>` boundary headings are assembly artifacts — never persisted;
 *   - `${sectionId}__` id prefixes are stripped before save;
 *   - each section carries its own `version` as the CAS `baseVersion`; a 409 is a non-destructive
 *     explicit-overwrite gate, a 423 means the section locked under you.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CanvasRenderer } from './canvas-renderer';
import { SelectionToolbar } from './selection-toolbar';
import { CanvasOverlayBar, overlayClass, useOverlays } from './canvas-overlays';
import { selectionLabel, type CanvasSelection } from '@/lib/canvas/selection';
import { originalNodeId, reconstructSectionDoc, type AssembledProposal, type FluidSectionMeta } from '@/lib/canvas/assemble-proposal';
import type { CanvasDocument, CanvasNode } from '@/lib/types/canvas-document';
import { toast } from '@/lib/toast';

interface Props {
  assembled: AssembledProposal;
  /** Per-section save metadata (version / editable / frame) from the document route. */
  sections: FluidSectionMeta[];
  /** Whether the viewer is a proposal admin (gates lock/assign — F2b). */
  canManage?: boolean;
  tenantSlug: string;
  proposalId: string;
  variables?: Record<string, string>;
  /** When false the selection toolbar is suppressed (pure view). Defaults on. */
  canAct?: boolean;
}

/** A safe `[data-node-id=…]` selector for an id that may carry `:` / `__`. */
const anchorSel = (id: string) =>
  `[data-node-id=${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : `"${id.replace(/["\\]/g, '\\$&')}"`}]`;

const STATUS_DOT: Record<string, string> = {
  empty: 'bg-gray-300', ai_drafted: 'bg-yellow-400', in_progress: 'bg-blue-400',
  complete: 'bg-green-500', approved: 'bg-emerald-500',
};

export function FluidDocumentView({ assembled, sections, canManage = false, tenantSlug, proposalId, variables, canAct = true }: Props) {
  const { sectionOf, outline } = assembled;
  const [doc, setDoc] = useState<CanvasDocument>(assembled.doc);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(outline[0]?.sectionId ?? null);
  const [selBusy, setSelBusy] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc); docRef.current = doc;
  // Per-section CAS base version (seeded from the load; advanced on each save response).
  const versionRef = useRef<Map<string, number>>(new Map(sections.map((s) => [s.id, s.version])));
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Structure-as-overlay (Phase 1): togglable dotted Sections / Atoms / Provenance layers.
  const { active: overlays, toggle: toggleOverlay } = useOverlays();

  const sectionsById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const anyEditable = useMemo(() => sections.some((s) => s.editable), [sections]);
  const statusOf = useMemo(() => new Map(sections.map((s) => [s.id, s.status])), [sections]);

  // Re-seed if the parent hands us a fresh assemble (e.g. after an external refresh).
  useEffect(() => {
    setDoc(assembled.doc);
    setDirty(new Set());
    versionRef.current = new Map(sections.map((s) => [s.id, s.version]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assembled]);

  const editableOf = useCallback((assembledNodeId: string): FluidSectionMeta | null => {
    if (assembledNodeId.startsWith('sec:')) return null; // synthetic boundary — never editable
    const owner = sectionOf[assembledNodeId];
    const sec = owner ? sectionsById.get(owner.id) : undefined;
    return sec && sec.editable && !sec.isLocked ? sec : null;
  }, [sectionOf, sectionsById]);

  // ── Active-section-on-scroll ────────────────────────────────────────
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const anchors = outline
      .map((o) => root.querySelector(anchorSel(o.anchorNodeId)))
      .filter((el): el is Element => !!el);
    if (!anchors.length) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        const id = (visible[0]?.target as HTMLElement | undefined)?.dataset.nodeId;
        const o = id ? outline.find((x) => x.anchorNodeId === id) : undefined;
        if (o) setActiveSection(o.sectionId);
      },
      { rootMargin: '-8% 0px -78% 0px', threshold: 0 },
    );
    anchors.forEach((a) => io.observe(a));
    return () => io.disconnect();
  }, [outline, doc]);

  const scrollTo = useCallback((anchorNodeId: string, sectionId: string) => {
    setActiveSection(sectionId);
    containerRef.current?.querySelector(anchorSel(anchorNodeId))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ── In-place editing (F2) ───────────────────────────────────────────
  const onSelectNode = useCallback((assembledNodeId: string | null) => {
    if (assembledNodeId === null) { setSelectedNodeId(null); return; }
    if (!editableOf(assembledNodeId)) {
      // A locked / prior-stage / unassigned section (or a synthetic boundary) — not editable.
      // Leave selection cleared so the node never enters its inline edit branch.
      setSelectedNodeId(null);
      return;
    }
    setSelectedNodeId(assembledNodeId);
  }, [editableOf]);

  const onUpdateNode = useCallback((assembledNodeId: string, content: CanvasNode['content']) => {
    const sec = editableOf(assembledNodeId);
    if (!sec) return; // gate: never mutate a non-editable section's node
    setDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) =>
        n.id === assembledNodeId
          ? { ...n, content, provenance: { ...(n.provenance ?? { source: 'manual' }), source: 'manual' } }
          : n,
      ),
    }));
    setDirty((prev) => { const next = new Set(prev); next.add(sec.id); return next; });
  }, [editableOf]);

  // Build a section's OWN flat save-doc from the (edited) assembled doc — the pure inverse of the
  // assembly (shared + unit-tested in lib/canvas/assemble-proposal.ts). Falls back to the assembled
  // frame only when the section carried no frame of its own.
  const buildSaveDoc = useCallback((secId: string): CanvasDocument => {
    const sec = sectionsById.get(secId);
    return reconstructSectionDoc(
      docRef.current,
      sectionOf,
      secId,
      (sec?.canvas ?? docRef.current.canvas) as CanvasDocument['canvas'],
      (sec?.metadata ?? { title: sec?.title ?? '' }) as CanvasDocument['metadata'],
    );
  }, [sectionOf, sectionsById]);

  const saveSection = useCallback(async (secId: string, retryOnConflict = true): Promise<boolean> => {
    const sec = sectionsById.get(secId);
    if (!sec) return false;
    const base = versionRef.current.get(secId) ?? sec.version;
    let res: Response;
    try {
      res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${secId}/save`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: buildSaveDoc(secId), baseVersion: base, source: 'human_edit' }),
      });
    } catch {
      toast.error(`Couldn’t save “${sec.title ?? 'section'}” — network error.`);
      return false;
    }
    if (res.status === 423) {
      const j = await res.json().catch(() => ({}));
      toast.error(j?.error ?? `“${sec.title ?? 'Section'}” is locked and can’t be edited.`);
      return false;
    }
    if (res.status === 409) {
      const j = await res.json().catch(() => ({} as { currentVersion?: number }));
      if (retryOnConflict && typeof window !== 'undefined' &&
          window.confirm(`“${sec.title ?? 'This section'}” changed elsewhere since you opened it. Overwrite with your version?`)) {
        if (typeof j.currentVersion === 'number') versionRef.current.set(secId, j.currentVersion);
        return saveSection(secId, false);
      }
      toast.error(`“${sec.title ?? 'Section'}” wasn’t saved — it changed elsewhere.`);
      return false;
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(j?.error ?? `Couldn’t save “${sec.title ?? 'section'}”.`); return false; }
    if (typeof j?.data?.version === 'number') versionRef.current.set(secId, j.data.version);
    const warnings = j?.data?.complianceWarnings as { message?: string }[] | undefined;
    if (warnings?.length) toast.info(`“${sec.title ?? 'Section'}”: ${warnings[0]?.message ?? 'compliance note'}`);
    return true;
  }, [sectionsById, tenantSlug, proposalId, buildSaveDoc]);

  const flushSaves = useCallback(async () => {
    const ids = [...dirty];
    if (!ids.length || saving) return;
    setSaving(true);
    const stillDirty = new Set<string>();
    for (const id of ids) {
      const ok = await saveSection(id);
      if (!ok) stillDirty.add(id);
    }
    setDirty(stillDirty);
    setSaving(false);
    if (stillDirty.size === 0) setSavedAt(Date.now());
  }, [dirty, saving, saveSection]);

  // Autosave: 1.5s after edits settle. Manual Save + Ctrl-S also flush.
  useEffect(() => {
    if (dirty.size === 0) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { void flushSaves(); }, 1500);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [dirty, flushSaves]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void flushSaves(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flushSaves]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (dirty.size > 0) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // ── Selection verbs (F0/F2) ─────────────────────────────────────────
  const selectionAtomize = useCallback(
    async (sel: CanvasSelection) => {
      const text = sel.text.trim();
      if (text.length < 20) { toast.info('Select a bit more text to atomize (≥ 20 characters).'); return; }
      const owner = sectionOf[sel.nodeIds[0]];
      if (!owner) { toast.error('Could not resolve the section for this selection.'); return; }
      setSelBusy(true);
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${owner.id}/atomize-node`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: originalNodeId(sel.nodeIds[0], owner.id), heading: selectionLabel(sel) || owner.title, text, tags: [] }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok) toast.success(j?.data?.deduped ? `Matched an existing atom (from “${owner.title}”).` : `Saved as a library atom (from “${owner.title}”).`);
        else toast.error(j?.error ?? 'Could not atomize the selection.');
      } catch { toast.error('Could not atomize the selection.'); }
      finally { setSelBusy(false); window.getSelection()?.removeAllRanges(); }
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
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: owner.id, text: `“${snippet}” — ${note.trim()}` }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok) toast.success(`Note added to “${owner.title}”.`);
        else toast.error(j?.error ?? 'Could not add the note.');
      } catch { toast.error('Could not add the note.'); }
      finally { setSelBusy(false); window.getSelection()?.removeAllRanges(); }
    },
    [sectionOf, tenantSlug, proposalId],
  );

  const dirtyCount = dirty.size;
  const saveLabel = saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} section${dirtyCount === 1 ? '' : 's'}` : 'Saved';

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Slim action bar: overlays + editable save state (the Manage tab-row dissolves into this). */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 px-1">
        <CanvasOverlayBar active={overlays} onToggle={toggleOverlay} />
        {anyEditable && (
          <div className="flex items-center gap-2">
            {dirtyCount > 0 && !saving && <span className="text-[11px] text-amber-600">{dirtyCount} unsaved</span>}
            {savedAt && dirtyCount === 0 && !saving && <span className="text-[11px] text-gray-400">All changes saved</span>}
            <button
              onClick={() => void flushSaves()}
              disabled={saving || dirtyCount === 0}
              className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {saveLabel}
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-4 flex-1 min-h-0">
        {/* Outline rail — now carries per-section status (the "All Sections" list, folded in). */}
        <nav className="hidden md:block w-56 shrink-0 self-start sticky top-2 max-h-[calc(100vh-1rem)] overflow-y-auto py-3 pr-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2 px-2">Document outline</div>
          <ul className="space-y-0.5">
            {outline.map((o, i) => {
              const active = activeSection === o.sectionId;
              const newVolume = i === 0 || outline[i - 1].volumeName !== o.volumeName;
              const st = statusOf.get(o.sectionId) ?? 'empty';
              const isDirty = dirty.has(o.sectionId);
              const locked = sectionsById.get(o.sectionId)?.isLocked;
              return (
                <li key={o.sectionId}>
                  {newVolume && o.volumeName && (
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mt-3 mb-1 px-2 truncate">{o.volumeName}</div>
                  )}
                  <button
                    onClick={() => scrollTo(o.anchorNodeId, o.sectionId)}
                    className={`w-full flex items-center gap-2 text-left text-sm rounded px-2 py-1 transition-colors border-l-2 ${
                      active ? 'bg-blue-50 text-blue-700 font-medium border-blue-500' : 'text-gray-600 hover:bg-gray-50 border-transparent'
                    }`}
                    title={o.title}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[st] ?? 'bg-gray-300'}`} />
                    <span className="flex-1 min-w-0 truncate">{o.title}</span>
                    {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />}
                    {locked && <span className="text-[10px] text-gray-400 shrink-0" title="Locked">🔒</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* The continuous document. userSelect:text keeps the render selectable for the verb menu. */}
        <div ref={containerRef} className={`flex-1 min-w-0 overflow-y-auto ${overlayClass(overlays)}`} style={{ userSelect: 'text' }}>
          <CanvasRenderer
            document={doc}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            onUpdateNode={onUpdateNode}
            variables={variables}
            readOnly={!anyEditable}
          />
          {canAct && <SelectionToolbar doc={doc} busy={selBusy} onAtomize={selectionAtomize} onAnnotate={selectionAnnotate} />}
        </div>
      </div>
    </div>
  );
}
