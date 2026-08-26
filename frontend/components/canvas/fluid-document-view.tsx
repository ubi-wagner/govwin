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
import { CanvasOverlayBar, overlayClass, useOverlays, overlaysFor } from './canvas-overlays';
import { selectionLabel, type CanvasSelection } from '@/lib/canvas/selection';
import { originalNodeId, reconstructSectionDoc, type AssembledProposal, type FluidSectionMeta } from '@/lib/canvas/assemble-proposal';
import { estimatePageCount, getNodeText, withCanvasDefaults, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';
import { toast } from '@/lib/toast';
import { ScopeBar, type ScopeAction } from './scope-bar';
import type { Scope, Selection } from '@/lib/canvas/scope';

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

export function FluidDocumentView({ assembled, sections: sectionsProp, canManage = false, tenantSlug, proposalId, variables, canAct = true }: Props) {
  const { sectionOf, outline } = assembled;
  // Partial-canvas normalization (B78) — an assembled multi-section document inherits the
  // canvas of whichever section supplied it, and those are not all complete.
  const [doc, setDoc] = useState<CanvasDocument>(() => withCanvasDefaults(assembled.doc));
  // Per-section meta held in STATE so a lock/unlock (F2b) flips editability live without a reload.
  const [sections, setSections] = useState<FluidSectionMeta[]>(sectionsProp);
  const [lockBusy, setLockBusy] = useState<string | null>(null);
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
  // Save-integrity refs (F2 autosave hardening — proven bug sweep):
  //  · failedRef — sections whose LAST save failed (423 lock / declined 409 / error). Excluded from
  //    the debounced auto-retry so a lock or a declined conflict can't storm the endpoint or re-pop
  //    window.confirm every 1.5s; a fresh edit (or an explicit Save) re-enables the retry.
  //  · editedDuringSaveRef — sections edited WHILE a flush was in flight; kept dirty so mid-save
  //    keystrokes aren't dropped when the in-flight save resolves.
  //  · dirtyRef / savingRef / flushRef — synchronous mirrors so the UNMOUNT flush (a tab switch
  //    unmounts this surface; beforeunload does NOT fire on a React unmount) and the edit-time
  //    gating read live values without waiting on a re-render.
  const failedRef = useRef<Set<string>>(new Set());
  const editedDuringSaveRef = useRef<Set<string>>(new Set());
  const savingRef = useRef(false);
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const flushRef = useRef<null | (() => void | Promise<void>)>(null);
  // Structure-as-overlay (Phase 1): togglable dotted Sections / Atoms / Provenance layers.
  const { active: overlays, toggle: toggleOverlay } = useOverlays();
  // F3 — the two remaining overlay layers (Compliance coverage · Budget/pages), wired here off
  // real data (the compliance matrix + estimatePageCount). Off by default, summonable chips.
  const [showCompliance, setShowCompliance] = useState(false);
  const [showBudget, setShowBudget] = useState(false);
  const [compCoverage, setCompCoverage] = useState<{ met: number; total: number } | null>(null);
  useEffect(() => {
    if (!showCompliance || compCoverage) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/compliance`);
        const j = await res.json().catch(() => ({}));
        const items = (j?.data?.items ?? []) as { status?: string }[];
        if (alive) setCompCoverage({ met: items.filter((i) => i.status === 'satisfied').length, total: items.length });
      } catch { if (alive) setCompCoverage({ met: 0, total: 0 }); }
    })();
    return () => { alive = false; };
  }, [showCompliance, compCoverage, tenantSlug, proposalId]);

  const budget = useMemo(() => {
    const est = estimatePageCount(doc);
    // Whole-doc page budget = the SUM of each section's OWN page limit. The assembled canvas adopts only
    // the LAST narrative section's frame, so reading doc.canvas.max_pages compared a whole-doc estimate
    // against a single section's cap (a misleading "~N of M" read-out). null when no section caps pages.
    const perSection = sections
      .map((s) => (s.canvas as { max_pages?: number | null } | null | undefined)?.max_pages)
      .filter((m): m is number => typeof m === 'number' && m > 0);
    const max = perSection.length ? perSection.reduce((a, b) => a + b, 0) : null;
    return { est, max };
  }, [doc, sections]);
  const sectionsById = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const anyEditable = useMemo(() => sections.some((s) => s.editable), [sections]);
  const statusOf = useMemo(() => new Map(sections.map((s) => [s.id, s.status])), [sections]);

  // Re-seed if the parent hands us a fresh assemble (e.g. after an external refresh).
  useEffect(() => {
    setDoc(assembled.doc);
    setSections(sectionsProp);
    setDirty(new Set());
    versionRef.current = new Map(sectionsProp.map((s) => [s.id, s.version]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assembled]);

  // F2b — lock (accept) / unlock a section straight from the canvas outline rail (admins only).
  // A lock flips the section to read-only (editable=false) live; unlock reopens it for edit.
  const toggleLock = useCallback(async (secId: string) => {
    const sec = sections.find((s) => s.id === secId);
    if (!sec || !canManage) return;
    setLockBusy(secId);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${secId}/lock`, {
        method: sec.isLocked ? 'DELETE' : 'POST',
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j?.error ?? `Couldn’t ${sec.isLocked ? 'unlock' : 'lock'} the section.`); return; }
      const nowLocked = !sec.isLocked;
      // Locked → read-only; reopened → editable (the admin acting here is tenant-wide, so an
      // unlocked current-stage section is theirs to edit; the save route re-enforces regardless).
      setSections((prev) => prev.map((s) => s.id === secId ? { ...s, isLocked: nowLocked, editable: !nowLocked, status: nowLocked ? 'approved' : 'in_progress' } : s));
      toast.success(nowLocked ? `“${sec.title ?? 'Section'}” locked.` : `“${sec.title ?? 'Section'}” reopened for edit.`);
    } catch { toast.error('Network error changing the section lock.'); }
    finally { setLockBusy(null); }
  }, [sections, canManage, tenantSlug, proposalId]);

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
    // `outline` (not `doc`) is the dep: the scroll anchors are the stable `sec:` boundary headings,
    // which don't change on a content edit — only when sections are added/removed (⇒ new outline).
    // Depending on `doc` here rebuilt the observer on every keystroke (perf churn, no correctness win).
  }, [outline]);

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
    failedRef.current.delete(sec.id);                              // a fresh edit re-enables auto-save retry
    if (savingRef.current) editedDuringSaveRef.current.add(sec.id); // don't let an in-flight flush clear it
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
      (sec?.sourceDoc ?? null) as CanvasDocument | null, // v2: preserve the section-layer structure
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
    // Only auto-flush sections that haven't already failed (a lock / declined conflict must not
    // storm the endpoint or re-pop confirm). Manual Save clears failedRef first so an explicit
    // save always retries.
    const ids = [...dirty].filter((id) => !failedRef.current.has(id));
    if (!ids.length || savingRef.current) return;
    setSaving(true); savingRef.current = true;
    editedDuringSaveRef.current = new Set();          // track edits that land WHILE this flush runs
    const succeeded = new Set<string>();
    for (const id of ids) {
      const ok = await saveSection(id);
      if (ok) succeeded.add(id); else failedRef.current.add(id);
    }
    // Clear ONLY sections that saved AND weren't edited again mid-flush — otherwise keep them dirty
    // so the just-typed keystrokes aren't dropped (they flush on the next cycle).
    if (succeeded.size) {
      setDirty((prev) => {
        const next = new Set(prev);
        for (const id of succeeded) if (!editedDuringSaveRef.current.has(id)) next.delete(id);
        return next;
      });
      setSavedAt(Date.now());
    }
    setSaving(false); savingRef.current = false;
  }, [dirty, saveSection]);

  // Explicit Save (button / Ctrl-S): retry even sections that previously failed — the user asked.
  const manualFlush = useCallback(() => { failedRef.current.clear(); void flushSaves(); }, [flushSaves]);

  // Autosave: 1.5s after edits settle. Manual Save + Ctrl-S also flush. Sections whose last save
  // FAILED are excluded here (no auto-retry storm) — a fresh edit clears the flag and re-arms them.
  useEffect(() => {
    const pending = [...dirty].filter((id) => !failedRef.current.has(id));
    if (!pending.length) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { void flushSaves(); }, 1500);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [dirty, flushSaves]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); manualFlush(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [manualFlush]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => { if (dirty.size > 0) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  // Keep flushRef pointed at the latest flushSaves so the unmount cleanup calls the current one.
  useEffect(() => { flushRef.current = flushSaves; });
  // Flush pending saves on UNMOUNT — a workspace tab switch unmounts this surface, and beforeunload
  // does NOT fire on a React unmount, so without this the debounced autosave would be silently
  // dropped. The in-flight fetch survives the unmount (the page itself stays), so the edit persists.
  useEffect(() => () => { if (dirtyRef.current.size) void flushRef.current?.(); }, []);

  // ── Selection verbs (F0/F2/F4) ──────────────────────────────────────
  // F4 multi-target: a selection spanning N sections atomizes EACH section's own portion into its
  // own atom (routed via sectionOf), not just the first section. Single-section spans behave as F0.
  const selectionAtomize = useCallback(
    async (sel: CanvasSelection) => {
      if (sel.text.trim().length < 20) { toast.info('Select a bit more text to atomize (≥ 20 characters).'); return; }
      // Group the span's nodes by owning section, preserving order; per-node text from the doc.
      const textOf = new Map(doc.nodes.map((n) => [n.id, getNodeText(n as CanvasNode)]));
      const groups: { secId: string; title: string; nodeIds: string[] }[] = [];
      for (const nid of sel.nodeIds) {
        if (nid.startsWith('sec:')) continue;
        const owner = sectionOf[nid];
        if (!owner) continue;
        const g = groups.find((x) => x.secId === owner.id) ?? (groups.push({ secId: owner.id, title: owner.title, nodeIds: [] }), groups[groups.length - 1]);
        g.nodeIds.push(nid);
      }
      if (!groups.length) { toast.error('Could not resolve the section(s) for this selection.'); return; }
      setSelBusy(true);
      let ok = 0, skipped = 0;
      try {
        for (const g of groups) {
          const text = g.nodeIds.map((id) => textOf.get(id) ?? '').filter((t) => t.trim()).join('\n\n').trim();
          if (text.length < 20) { skipped++; continue; }
          const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${g.secId}/atomize-node`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nodeId: originalNodeId(g.nodeIds[0], g.secId), heading: g.title, text, tags: [] }),
          });
          if (res.ok) ok++; else skipped++;
        }
        if (ok && groups.length > 1) toast.success(`Atomized ${ok} section${ok === 1 ? '' : 's'} into ${ok} library atom${ok === 1 ? '' : 's'}.`);
        else if (ok) toast.success('Saved as a library atom.');
        if (!ok) toast.error('Could not atomize the selection.');
      } catch { toast.error('Could not atomize the selection.'); }
      finally { setSelBusy(false); window.getSelection()?.removeAllRanges(); }
    },
    [doc, sectionOf, tenantSlug, proposalId],
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

  // F2c — Compliance-check verb: advisory read of the compliance matrix for the span's OWNING
  // section (read-only, never writes). Reports coverage for that section.
  const selectionCompliance = useCallback(
    async (sel: CanvasSelection) => {
      const owner = sectionOf[sel.nodeIds[0]];
      if (!owner) { toast.error('Could not resolve the section for this selection.'); return; }
      setSelBusy(true);
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/compliance`);
        const j = await res.json().catch(() => ({}));
        const items = (j?.data?.items ?? []) as { status?: string; sectionId?: string | null }[];
        const mine = items.filter((it) => it.sectionId === owner.id);
        if (!mine.length) { toast.info(`No compliance requirements are mapped to “${owner.title}” yet.`); return; }
        const met = mine.filter((it) => it.status === 'satisfied').length;
        toast.info(`“${owner.title}”: ${met}/${mine.length} mapped requirement${mine.length === 1 ? '' : 's'} satisfied.`);
      } catch { toast.error('Could not run the compliance check.'); }
      finally { setSelBusy(false); window.getSelection()?.removeAllRanges(); }
    },
    [sectionOf, tenantSlug, proposalId],
  );

  // F2c — Reuse verb: surface reusable library atoms matching the highlighted text (advisory —
  // the writable insert lives in the section editor's library picker; this points you at matches).
  const selectionReuse = useCallback(
    async (sel: CanvasSelection) => {
      const q = sel.text.trim().slice(0, 80);
      if (q.length < 8) { toast.info('Select a bit more text to search the library.'); return; }
      setSelBusy(true);
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/library/atoms?q=${encodeURIComponent(q)}&limit=5`);
        const j = await res.json().catch(() => ({}));
        const atoms = (j?.data?.atoms ?? j?.data ?? []) as { title?: string }[];
        if (!Array.isArray(atoms) || !atoms.length) { toast.info('No matching library atoms found for this text.'); return; }
        toast.success(`${atoms.length} reusable atom${atoms.length === 1 ? '' : 's'} match — top: “${atoms[0]?.title ?? 'untitled'}”. Open the Library to insert.`);
      } catch { toast.error('Could not search the library.'); }
      finally { setSelBusy(false); window.getSelection()?.removeAllRanges(); }
    },
    [tenantSlug, proposalId],
  );

  // ── SCOPE (Phase B) ───────────────────────────────────────────────────────────────────────────
  // One piece of state for "what is focused", and it FOLLOWS the canvas selection rather than
  // living beside it. A panel with its own private idea of what is selected is how the same click
  // ends up meaning two different things in two places — the exact thing the scope work exists to
  // stop. Clicking a node in the document moves the scope to that node; the bar can then widen.
  const [scopeSel, setScopeSel] = useState<Selection>({});
  const [scopeBusy, setScopeBusy] = useState(false);
  useEffect(() => { if (selectedNodeId) setScopeSel({ nodeId: selectedNodeId }); }, [selectedNodeId]);

  /** Queue a colour-team review of exactly the focused scope. Advisory — it posts findings. */
  const reviewScope = useCallback(async (scope: Scope, sel: Selection) => {
    setScopeBusy(true);
    try {
      // The section hint disambiguates a RAW node id from the per-section editor. Here the ids are
      // already assembly-scoped, so it is belt-and-braces — but sending it costs nothing and makes
      // the same call correct from either surface, which is what continuity means in practice.
      const hint = sel.nodeId ? sectionOf[sel.nodeId]?.id : undefined;
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/ai-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: { ...sel, ...(hint ? { sectionId: hint } : {}) } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j?.error ?? 'Could not queue that review.'); return; }
      toast.success(`Review queued for ${j?.data?.scope?.label ?? scope.label}.`);
    } catch { toast.error('Could not queue that review.'); }
    finally { setScopeBusy(false); }
  }, [tenantSlug, proposalId, sectionOf]);

  /** Re-assemble a section from the tenant's library, landing a PROPOSED version to review. */
  const assembleScope = useCallback(async (scope: Scope) => {
    setScopeBusy(true);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${scope.id}/assemble`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) },
      );
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(j?.error ?? 'Could not assemble from the library.'); return; }
      const d = j?.data ?? {};
      const skipped = (d.skipped ?? []).length;
      toast.success(
        `Proposed a draft from ${d.atoms?.length ?? 0} library atom${d.atoms?.length === 1 ? '' : 's'} `
        + `(${d.pagesUsed} page${d.pagesUsed === 1 ? '' : 's'}${skipped ? `, ${skipped} did not fit` : ''}). `
        + 'Review it in the section’s version history.',
      );
    } catch { toast.error('Could not assemble from the library.'); }
    finally { setScopeBusy(false); }
  }, [tenantSlug, proposalId]);

  const scopeActions = useMemo<ScopeAction[]>(() => [
    {
      id: 'review',
      label: 'Adversarial review of this scope',
      hint: 'Queue a colour-team reviewer aimed at exactly this content. Advisory — it posts findings, it never edits.',
      levels: ['node', 'group', 'section', 'pages', 'document'],
      run: (scope, sel) => reviewScope(scope, sel),
    },
    {
      id: 'assemble',
      // SECTION ONLY, and not because narrower is unsupported: the assembler builds a SECTION out
      // of ranked atoms. There is no smaller thing it produces, so offering it at node level would
      // promise something that does not exist.
      label: 'Re-assemble from the library',
      hint: 'Rank this tenant’s library for this section and propose a draft, fitted to its page budget. Lands for review; never overwrites.',
      levels: ['section'],
      run: (scope) => assembleScope(scope),
    },
  ], [reviewScope, assembleScope]);

  const dirtyCount = dirty.size;
  const saveLabel = saving ? 'Saving…' : dirtyCount > 0 ? `Save ${dirtyCount} section${dirtyCount === 1 ? '' : 's'}` : 'Saved';

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {/* Slim action bar: overlays + editable save state (the Manage tab-row dissolves into this). */}
      <div className="flex flex-wrap items-center justify-between gap-2 shrink-0 px-1">
        <div className="flex flex-wrap items-center gap-2">
          <CanvasOverlayBar active={overlays} onToggle={toggleOverlay} items={overlaysFor(doc)} />
          {/* F3 — Compliance + Budget layers (real data), summonable like the dotted layers. */}
          <button type="button" onClick={() => setShowCompliance((v) => !v)} aria-pressed={showCompliance}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${showCompliance ? 'border-transparent bg-rose-500 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
            title="Compliance coverage across the proposal">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: showCompliance ? '#fff' : '#f43f5e', opacity: showCompliance ? 1 : 0.5 }} />Compliance
          </button>
          <button type="button" onClick={() => setShowBudget((v) => !v)} aria-pressed={showBudget}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${showBudget ? 'border-transparent bg-amber-500 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
            title="Page budget vs. the solicitation limit">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: showBudget ? '#fff' : '#f59e0b', opacity: showBudget ? 1 : 0.5 }} />Budget
          </button>
        </div>
        {anyEditable && (
          <div className="flex items-center gap-2">
            {dirtyCount > 0 && !saving && <span className="text-[11px] text-amber-600">{dirtyCount} unsaved</span>}
            {savedAt && dirtyCount === 0 && !saving && <span className="text-[11px] text-gray-400">All changes saved</span>}
            <button
              onClick={manualFlush}
              disabled={saving || dirtyCount === 0}
              className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {saveLabel}
            </button>
          </div>
        )}
      </div>

      {/* F3 layer read-outs (real data): compliance coverage + page budget. */}
      {(showCompliance || showBudget) && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 shrink-0 px-1 text-xs">
          {showCompliance && (
            <span className="inline-flex items-center gap-1.5 text-rose-700">
              <span className="font-medium">Compliance:</span>
              {compCoverage === null ? 'checking…' : compCoverage.total === 0 ? 'no requirements mapped' : `${compCoverage.met}/${compCoverage.total} requirements satisfied`}
            </span>
          )}
          {showBudget && (
            <span className={`inline-flex items-center gap-1.5 ${budget.max != null && budget.est > budget.max ? 'text-red-600 font-medium' : 'text-amber-700'}`}>
              <span className="font-medium">Budget:</span>
              {`~${budget.est} page${budget.est === 1 ? '' : 's'}${budget.max != null ? ` of ${budget.max} allowed${budget.est > budget.max ? ' — over limit' : ''}` : ''}`}
            </span>
          )}
        </div>
      )}

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
                  <div className={`group flex items-center rounded border-l-2 ${active ? 'bg-blue-50 border-blue-500' : 'border-transparent hover:bg-gray-50'}`}>
                    <button
                      onClick={() => scrollTo(o.anchorNodeId, o.sectionId)}
                      className={`flex-1 min-w-0 flex items-center gap-2 text-left text-sm px-2 py-1 ${active ? 'text-blue-700 font-medium' : 'text-gray-600'}`}
                      title={o.title}
                    >
                      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[st] ?? 'bg-gray-300'}`} />
                      <span className="flex-1 min-w-0 truncate">{o.title}</span>
                      {isDirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" title="Unsaved changes" />}
                    </button>
                    {/* F2b: lock/unlock straight from the canvas (admins). Non-admins see a static state. */}
                    {canManage ? (
                      <button
                        onClick={() => void toggleLock(o.sectionId)}
                        disabled={lockBusy === o.sectionId}
                        className="shrink-0 px-1.5 text-[11px] text-gray-400 hover:text-gray-700 disabled:opacity-40"
                        title={locked ? 'Reopen this section for editing' : 'Lock (accept) this section'}
                      >
                        {lockBusy === o.sectionId ? '…' : locked ? '🔒' : '🔓'}
                      </button>
                    ) : (
                      locked && <span className="shrink-0 px-1.5 text-[10px] text-gray-400" title="Locked">🔒</span>
                    )}
                  </div>
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
            // The Grid chip was OFFERED on this surface and wired to nothing. `CanvasRenderer`
            // takes `grid` and defaults it to false; this view never passed it, and there is no CSS
            // rule for `ov-grid` either, so the class `overlayClass` adds paints nothing on its own.
            // The result: on the DEFAULT tab of the proposal workspace — the main authoring surface
            // — an author toggled Grid, the chip lit up, and no grid appeared. Measured at 0.09%
            // pixel change (the chip itself) against 2.02% where it works.
            //
            // Wiring it is the right fix rather than hiding the chip: this is the assembled
            // document, where page boundaries across eleven pages are exactly what a measurement
            // grid is for.
            grid={overlays.has('grid')}
          />
          {canAct && (
            <SelectionToolbar
              doc={doc}
              busy={selBusy}
              onAtomize={selectionAtomize}
              onAnnotate={selectionAnnotate}
              onReuse={selectionReuse}
              onComplianceCheck={selectionCompliance}
            />
          )}
        </div>

        {/* ── THE SCOPE BAR ────────────────────────────────────────────────────────────────────
            The right column, acting on whatever rung the reader has focused. Mounted HERE rather
            than only in the per-section editor because this is the surface where every rung is
            meaningful: a page range and a whole-document scope have no meaning inside one section.

            `sectionOf` is what lets the ladder name a section at all — the assembled document is
            one flat node list (that is what reading a continuous document needs), so without the
            map the ladder would jump from `node` straight to `document` and lose the rung the
            compliance matrix, the mold and the review queue all address. */}
        {canAct && (
          <aside className="w-72 shrink-0 overflow-y-auto pl-1">
            <ScopeBar
              doc={doc}
              selection={scopeSel}
              onSelectionChange={setScopeSel}
              sectionOf={sectionOf}
              busy={scopeBusy}
              actions={scopeActions}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
