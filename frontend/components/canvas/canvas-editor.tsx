'use client';

/**
 * Canvas Editor — the full section editing workspace.
 *
 * Combines the CanvasRenderer (WYSIWYG page view) + CanvasSidebar
 * (compliance, node info, add content) into a single component.
 * Manages the document state, node CRUD, and save/export actions.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { CanvasDocument, CanvasNode, NodeType, NodeStyle, CanvasRules } from '@/lib/types/canvas-document';
import type { LibraryAtomCandidate } from './library-picker';
import { createNode, getNodeText, toEditableFlat, withCanvasDefaults } from '@/lib/types/canvas-document';
import type { CanvasCapabilities } from '@/lib/canvas/capabilities';
import { CanvasRenderer } from './canvas-renderer';
import { SlideEditor } from './slide-editor';
import { SheetEditor } from './sheet-editor';
import { CanvasSidebar } from './canvas-sidebar';
import { CanvasToolbar } from './canvas-toolbar';
import { SelectionToolbar } from './selection-toolbar';
import { selectionLabel, type CanvasSelection } from '@/lib/canvas/selection';
import { toast } from '@/lib/toast';
import { LibraryInsertPanel, type InsertAtom } from './library-insert-panel';
import { DocumentPreview } from './document-preview';
import { AtomBubbleRail, type AtomBubble } from '@/components/atomization/atom-bubble-rail';
import { useUnsavedChanges } from '@/components/admin/admin-nav-context';

/** The classified section-type is carried as a `type:<key>` entry in library_tags. */
function typeFromLibraryTags(tags?: string[]): string | null {
  const t = (tags ?? []).find((x) => x.startsWith('type:'));
  return t ? t.slice('type:'.length) : null;
}

/** A short bubble heading for a node — the heading text, or a content snippet. */
function nodeHeading(n: CanvasNode): string {
  if (n.type === 'heading' && n.content && typeof n.content === 'object' && 'text' in n.content) {
    return String((n.content as { text?: string }).text ?? '') || 'Heading';
  }
  const t = getNodeText(n);
  return t ? t.slice(0, 60) : '(empty)';
}

/** Metadata about the last AI revision, used to tag the save with the correct source */
interface RevisionMeta {
  source: 'ai_revision' | 'ai_draft' | 'library_import';
  aiInstruction: string;
}

interface Props {
  initialDocument: CanvasDocument;
  onSave: (doc: CanvasDocument) => Promise<void>;
  onExport?: (doc: CanvasDocument, format: 'docx' | 'pptx' | 'xlsx' | 'pdf') => Promise<void>;
  /** Called after a successful Complete & Lock, so the host can refresh (the
   *  server then re-renders the now-locked section read-only). */
  onLocked?: () => void;
  variables?: Record<string, string>;
  readOnly?: boolean;
  /** The live tool set (role × stage × permission). When present, gates the
   *  fine tools (atomize / insert-from-library); falls back to !readOnly. */
  capabilities?: CanvasCapabilities;
  /** Process stage — orders the sidebar toolbox card list. */
  stage?: string;
  actorId: string;
  actorName: string;
  /** Proposal ID — enables AI revision and comments when present */
  proposalId?: string;
  /** Section ID — included for context */
  sectionId?: string;
  /** Tenant slug — enables comments API when present */
  tenantSlug?: string;
  /** Stable per-artifact key for the local recovery draft (the unique save URL is a good key). */
  autosaveKey?: string;

  // ── Ribbon state callbacks (SectionTopRibbon integration) ──────────────
  // When a SectionTopRibbon is mounted above this editor, it needs to reflect
  // the editor's live state without owning the doc state. These optional
  // callbacks push state up; the ribbon's trigger refs pull actions down.
  onDirtyChange?:    (dirty: boolean)   => void;
  onSavingChange?:   (saving: boolean)  => void;
  onSaveErrorChange?:(err: string|null) => void;
  onUndoCountChange?:(n: number)        => void;
  onRedoCountChange?:(n: number)        => void;
  onUndoTrailChange?:(trail: string[])  => void;
  onRedoTrailChange?:(trail: string[])  => void;
  onNodeCountChange?:(n: number)        => void;
  onStatusChange?:   (s: string)        => void;
  onFormatChange?:   (f: string)        => void;
  onHasTableChange?: (h: boolean)       => void;
  /** When set, the ribbon owns the panel-open state (overrides local). */
  externalPanelOpen?: boolean;
  /** Imperative trigger refs — ribbon buttons call these to invoke editor actions. */
  triggerSaveRef?:   React.MutableRefObject<(() => void) | null>;
  triggerUndoRef?:   React.MutableRefObject<(() => void) | null>;
  triggerRedoRef?:   React.MutableRefObject<(() => void) | null>;
  triggerLockRef?:   React.MutableRefObject<(() => void) | null>;
  triggerPanelRef?:  React.MutableRefObject<(() => void) | null>;
  triggerExportRef?: React.MutableRefObject<((format: 'docx'|'pptx'|'xlsx'|'pdf') => void) | null>;
}

function nodeTypeLabel(type: NodeType): string {
  switch (type) {
    case 'heading':       return 'heading';
    case 'text_block':    return 'text block';
    case 'bulleted_list': return 'bullet list';
    case 'numbered_list': return 'numbered list';
    case 'image':         return 'image';
    case 'table':         return 'table';
    case 'caption':       return 'caption';
    case 'footnote':      return 'footnote';
    case 'toc':           return 'table of contents';
    case 'url':           return 'link';
    default:              return 'block';
  }
}

function styleChangeLabel(style: Partial<NodeStyle>): string {
  if ('reuse_marker'  in style) return 'Mark reuse';
  if ('background'    in style) return 'Highlight';
  if ('color'         in style) return 'Text color';
  if ('underline'     in style || 'strikethrough' in style) return 'Text decoration';
  if ('weight'        in style) return 'Bold';
  if ('style'         in style) return 'Italic';
  if ('alignment'     in style) return 'Alignment';
  if ('size'          in style) return 'Font size';
  return 'Format text';
}

function defaultContent(type: NodeType): CanvasNode['content'] {
  switch (type) {
    case 'heading': return { level: 2, text: 'New Section' };
    case 'text_block': return { text: '' };
    case 'bulleted_list': return { items: [{ text: 'Item 1' }] };
    case 'numbered_list': return { items: [{ text: 'Step 1' }] };
    case 'image': return { storage_key: '', alt_text: 'Image', width: 400, height: 300 };
    case 'table': return { headers: ['Column 1', 'Column 2'], rows: [['', '']] };
    case 'caption': return { prefix: 'Figure', number: 1, text: 'Caption text' };
    case 'footnote': return { marker: '1', text: 'Footnote text' };
    case 'toc': return { max_depth: 3 };
    case 'url': return { href: 'https://', display_text: 'Link text' };
    // ── Extended elements ──
    case 'shape': return { shape: 'rectangle', text: '' };
    case 'text_box': return { text: 'Text box' };
    case 'callout': return { variant: 'info', title: 'Note', text: 'Callout text' };
    case 'code_block': return { code: '// code', language: 'text' };
    case 'blockquote': return { text: 'Quote', cite: '' };
    case 'chart': return { chart_type: 'bar', categories: ['A', 'B', 'C'], series: [{ name: 'Series 1', data: [3, 7, 5] }] };
    case 'equation': return { latex: 'E = mc^2', display: true };
    case 'divider': return { thickness: 1, line_style: 'solid' };
    case 'video': return { url: '', caption: 'Video' };
    case 'signature': return { label: 'Authorized Representative' };
    default: return null;
  }
}

/**
 * Replace a node's TEXT with a library atom's prose, PRESERVING the node's content
 * shape. Returns the new content, or `null` when the node type has no single text
 * field a prose atom can sensibly fill (image/table/chart/list/…) — in which case the
 * caller leaves the node untouched instead of destroying its shape. Mirrors
 * `canReplaceFromLibrary` (lib/canvas/format-controls) which gates the button.
 */
function replaceNodeText(content: CanvasNode['content'], type: NodeType, text: string): CanvasNode['content'] | null {
  const c = (content ?? {}) as Record<string, unknown>;
  switch (type) {
    case 'text_block': case 'heading': case 'blockquote':
    case 'callout': case 'text_box': case 'caption': case 'footnote':
      return { ...c, text } as CanvasNode['content'];
    case 'code_block':
      return { ...c, code: text } as CanvasNode['content'];
    default:
      return null; // image / table / chart / list / shape / … — not a text swap
  }
}

/** A sensible starting look for a freshly-inserted extended element (so it's
 *  visible on the canvas immediately and has something to format). */
function defaultStyle(type: NodeType): NodeStyle | undefined {
  if (type === 'shape') return { fill: { color: '#DCE6F1' }, border: { color: '#94A3B8', width: 1 } };
  if (type === 'text_box') return { border: { color: '#CBD5E1', width: 1 } };
  return undefined;
}

export function CanvasEditor(props: Props) {
  // Normalize a v2 (section-layer) doc into a flat, editable doc so its content
  // is visible + editable in the canvas — every editor surface edits `nodes`.
  const initialDocument = toEditableFlat(withCanvasDefaults(props.initialDocument));

  // Delegate to SheetEditor for spreadsheet format
  if (initialDocument.canvas.format === 'spreadsheet') {
    return (
      <SheetEditor
        initialDocument={initialDocument}
        onSave={props.onSave}
        onExport={props.onExport}
        actorId={props.actorId}
        actorName={props.actorName}
        readOnly={props.readOnly}
      />
    );
  }

  return <CanvasEditorInner {...props} initialDocument={initialDocument} />;
}

function CanvasEditorInner({
  initialDocument,
  onSave,
  onExport,
  variables,
  readOnly = false,
  capabilities,
  stage,
  onLocked,
  actorId,
  actorName,
  proposalId,
  sectionId,
  autosaveKey,
  tenantSlug,
  onDirtyChange,
  onSavingChange,
  onSaveErrorChange,
  onUndoCountChange,
  onRedoCountChange,
  onUndoTrailChange,
  onRedoTrailChange,
  onNodeCountChange,
  onStatusChange,
  onFormatChange,
  onHasTableChange,
  externalPanelOpen,
  triggerSaveRef,
  triggerUndoRef,
  triggerRedoRef,
  triggerLockRef,
  triggerPanelRef,
  triggerExportRef,
}: Props) {
  const [doc, setDoc] = useState<CanvasDocument>(initialDocument);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<{ doc: CanvasDocument; label: string }[]>([]);
  const [redoStack, setRedoStack] = useState<{ doc: CanvasDocument; label: string }[]>([]);
  const lastRevisionMetaRef = useRef<RevisionMeta | null>(null);

  // ── Local draft autosave + recover-on-reload (W1.2) ──────────────────
  // Every change is debounced to localStorage so a tab-close / crash / reload never loses
  // work; on mount we offer to restore a newer local draft. The manual Save (button / Ctrl+S)
  // is still the only SERVER write — this is the local safety net that makes reload safe.
  // Autosave is scoped to a STABLE per-document key. If the caller supplies none of
  // autosaveKey/sectionId/proposalId, DISABLE autosave (draftKey=null) rather than fall back to a
  // shared constant — a shared key cross-contaminates unrelated editors (recovering doc A's draft
  // into editor B, which Save then persists over B). Every real mount passes a key.
  const draftScope = autosaveKey ?? sectionId ?? proposalId ?? null;
  const draftKey = draftScope ? `canvas-draft:${draftScope}` : null;
  const [recoverable, setRecoverable] = useState<CanvasDocument | null>(null);
  const draftCheckedRef = useRef(false);

  useEffect(() => {
    if (!draftKey || draftCheckedRef.current) return;
    draftCheckedRef.current = true;
    try {
      const raw = typeof window !== 'undefined' ? window.localStorage.getItem(draftKey) : null;
      if (!raw) return;
      const saved = JSON.parse(raw) as { doc?: CanvasDocument };
      if (saved?.doc && JSON.stringify(saved.doc.nodes) !== JSON.stringify(initialDocument.nodes)) {
        setRecoverable(saved.doc);
      } else if (typeof window !== 'undefined') {
        window.localStorage.removeItem(draftKey);
      }
    } catch { /* ignore a corrupt draft */ }
  }, [draftKey, initialDocument]);

  useEffect(() => {
    if (!dirty || !draftKey || typeof window === 'undefined') return;
    const t = setTimeout(() => {
      try { window.localStorage.setItem(draftKey, JSON.stringify({ doc, savedAt: Date.now() })); } catch { /* quota / private mode */ }
    }, 1200);
    return () => clearTimeout(t);
  }, [doc, dirty, draftKey]);

  const handleRestoreDraft = useCallback(() => {
    // Normalize the recovered draft the same way the mount path does — a partial/legacy persisted doc
    // would otherwise crash the editor on setDoc (the mount-time withCanvasDefaults doesn't cover this path).
    setRecoverable((rec) => { if (rec) { setDoc(withCanvasDefaults(rec)); setDirty(true); } return null; });
  }, []);
  const handleDiscardDraft = useCallback(() => {
    try { if (draftKey && typeof window !== 'undefined') window.localStorage.removeItem(draftKey); } catch { /* ignore */ }
    setRecoverable(null);
  }, [draftKey]);

  // ── Fine tools gated by the resolved capabilities (role × stage), falling back
  //    to !readOnly when the caller hasn't resolved them yet. ──
  const canAtomize = Boolean(tenantSlug && proposalId && sectionId && (capabilities?.canAtomize ?? !readOnly));
  const canInsertLibrary = Boolean(tenantSlug && (capabilities?.canInsertLibrary ?? !readOnly));
  const [showAtomRail, setShowAtomRail] = useState(false);
  const [showInsert, setShowInsert] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [standards, setStandards] = useState<Array<{ key: string; label: string }>>([]);
  const [atomBusyId, setAtomBusyId] = useState<string | null>(null);
  const [acceptedNodeIds, setAcceptedNodeIds] = useState<Set<string>>(new Set());
  // Right panel (properties/AI/versions/tools): inline column on wide screens,
  // a toggleable overlay drawer when narrow (e.g. a Chrome split-screen half) so
  // it never starves the canvas. Default open on wide, collapsed on narrow.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    // Follow the breakpoint on mount AND on resize, so entering a Chrome
    // split-screen half (viewport crosses below 1024) auto-collapses the panel
    // and leaving it re-opens — the manual toggle still works within a breakpoint.
    const mq = window.matchMedia('(min-width: 1024px)');
    const apply = () => setSidebarOpen(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // ── Sync panel open/closed when the ribbon controls it externally ────
  useEffect(() => {
    if (externalPanelOpen !== undefined) setSidebarOpen(externalPanelOpen);
  }, [externalPanelOpen]);

  // ── Push live state up to ribbon (all best-effort) ────────────────────
  useEffect(() => { onDirtyChange?.(dirty);              }, [dirty, onDirtyChange]);
  useEffect(() => { onSavingChange?.(saving);            }, [saving, onSavingChange]);
  useEffect(() => { onSaveErrorChange?.(saveError);      }, [saveError, onSaveErrorChange]);
  useEffect(() => { onUndoCountChange?.(undoStack.length);}, [undoStack.length, onUndoCountChange]);
  useEffect(() => { onRedoCountChange?.(redoStack.length);}, [redoStack.length, onRedoCountChange]);
  useEffect(() => { onUndoTrailChange?.([...undoStack].reverse().map(e => e.label)); }, [undoStack, onUndoTrailChange]);
  useEffect(() => { onRedoTrailChange?.([...redoStack].reverse().map(e => e.label)); }, [redoStack, onRedoTrailChange]);
  useEffect(() => { onNodeCountChange?.(doc.nodes.length);}, [doc.nodes.length, onNodeCountChange]);
  useEffect(() => { onStatusChange?.(doc.metadata.status); }, [doc.metadata.status, onStatusChange]);
  useEffect(() => { onFormatChange?.(doc.canvas.format);   }, [doc.canvas.format, onFormatChange]);
  useEffect(() => {
    onHasTableChange?.(doc.nodes.some((n) => n.type === 'table'));
  }, [doc.nodes, onHasTableChange]);

  // Sync the editor's dirty flag to the admin nav guard (no-op outside /admin).
  useUnsavedChanges(dirty);

  // Load the section-standards vocabulary once for the rail's classify dropdown.
  useEffect(() => {
    if (!canAtomize || !tenantSlug) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/portal/${tenantSlug}/section-standards`);
        if (!res.ok) return;
        const body = await res.json();
        const rows: Array<{ key: string; label: string }> = body.data?.standards ?? [];
        if (!cancelled) setStandards(rows.map((s) => ({ key: s.key, label: s.label })));
      } catch {
        // non-critical — rail falls back to a free-tag flow
      }
    })();
    return () => { cancelled = true; };
  }, [canAtomize, tenantSlug]);

  const selectedNode = doc.nodes.find((n) => n.id === selectedNodeId) ?? null;
  const isSlideFormat = doc.canvas.format === 'slide_16_9' || doc.canvas.format === 'slide_4_3';

  const updateDoc = useCallback((updater: (prev: CanvasDocument) => CanvasDocument, label = 'Edit') => {
    setDoc((prev) => {
      setUndoStack(stack => {
        const next = [...stack, { doc: prev, label }];
        return next.length > 50 ? next.slice(-50) : next;
      });
      setRedoStack([]);

      const next = updater(prev);
      return {
        ...next,
        metadata: {
          ...next.metadata,
          last_modified_at: new Date().toISOString(),
          last_modified_by: actorId,
          version_number: prev.metadata.version_number + 1,
        },
      };
    });
    setDirty(true);
  }, [actorId]);

  const handleUpdateNode = useCallback((nodeId: string, content: CanvasNode['content']) => {
    // Human edit — clear AI revision metadata so the save isn't tagged as AI
    lastRevisionMetaRef.current = null;
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          content,
          // A human content edit makes the node human-owned. Clear the ai_draft provenance so the
          // Accept/Revert affordances (gated on source==='ai_draft') retire — otherwise Revert would
          // still restore the pre-AI snapshot and silently discard this manual edit.
          provenance: { ...n.provenance, source: 'manual' as const },
          history: [
            ...n.history,
            { actor_id: actorId, actor_name: actorName, action: 'edited' as const, timestamp: new Date().toISOString() },
          ],
        };
      }),
    }), 'Edit text');
  }, [updateDoc, actorId, actorName]);

  const handleAddNode = useCallback((type: NodeType, afterId?: string) => {
    const newNode = createNode({
      type,
      content: defaultContent(type),
      source: 'manual',
      actorId,
      actorName,
      style: defaultStyle(type),
    });

    updateDoc((prev) => {
      const nodes = [...prev.nodes];
      if (afterId) {
        const idx = nodes.findIndex((n) => n.id === afterId);
        nodes.splice(idx + 1, 0, newNode);
      } else {
        nodes.push(newNode);
      }
      return { ...prev, nodes };
    }, `Add ${nodeTypeLabel(type)}`);

    setSelectedNodeId(newNode.id);
  }, [updateDoc, actorId, actorName]);

  const handleDeleteNode = useCallback((nodeId: string) => {
    // Human edit — clear AI revision metadata
    lastRevisionMetaRef.current = null;
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
    }), 'Delete block');
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [updateDoc, selectedNodeId]);

  const handleMoveNodeToIndex = useCallback((nodeId: string, targetIndex: number) => {
    updateDoc((prev) => {
      const nodes = [...prev.nodes];
      const currentIndex = nodes.findIndex(n => n.id === nodeId);
      if (currentIndex === -1 || currentIndex === targetIndex) return prev;
      const [removed] = nodes.splice(currentIndex, 1);
      const insertAt = targetIndex > currentIndex ? targetIndex - 1 : targetIndex;
      nodes.splice(insertAt, 0, removed);
      return { ...prev, nodes };
    }, 'Reorder blocks');
  }, [updateDoc]);

  const handleMoveNode = useCallback((nodeId: string, direction: 'up' | 'down') => {
    // Human edit — clear AI revision metadata
    lastRevisionMetaRef.current = null;
    updateDoc((prev) => {
      const nodes = [...prev.nodes];
      const idx = nodes.findIndex((n) => n.id === nodeId);
      if (idx === -1) return prev;
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (newIdx < 0 || newIdx >= nodes.length) return prev;
      [nodes[idx], nodes[newIdx]] = [nodes[newIdx], nodes[idx]];
      return { ...prev, nodes };
    }, direction === 'up' ? 'Move block up' : 'Move block down');
  }, [updateDoc]);

  const handleAcceptNode = useCallback((nodeId: string) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        // Accept = keep the AI content as the human's own. Flipping source off
        // 'ai_draft' clears the pending Accept/Revert affordance (they are gated on it).
        return {
          ...n,
          provenance: { ...n.provenance, source: 'manual' as const },
          history: [
            ...n.history,
            { actor_id: actorId, actor_name: actorName, action: 'accepted' as const, timestamp: new Date().toISOString() },
          ],
        };
      }),
    }), 'Accept revision');
  }, [updateDoc, actorId, actorName]);

  const handleRevertNode = useCallback((nodeId: string) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        // Restore the content captured before the last revision. Walk history back to
        // the most recent entry that snapshotted previous_content; no-op if there is none.
        const snapshot = [...n.history].reverse().find((h) => h.previous_content != null);
        if (snapshot?.previous_content == null) return n;
        let restored: CanvasNode['content'];
        try { restored = JSON.parse(snapshot.previous_content) as CanvasNode['content']; }
        catch { return n; }
        return {
          ...n,
          content: restored,
          provenance: { ...n.provenance, source: 'manual' as const },
          history: [
            ...n.history,
            { actor_id: actorId, actor_name: actorName, action: 'reverted' as const, timestamp: new Date().toISOString() },
          ],
        };
      }),
    }), 'Revert block');
  }, [updateDoc, actorId, actorName]);

  const handleUpdateNodeStyle = useCallback((nodeId: string, style: Partial<NodeStyle>) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        return {
          ...n,
          style: { ...n.style, ...style },
        };
      }),
    }), styleChangeLabel(style));
  }, [updateDoc]);

  // Free-placement (content boxes / floating figures that don't snap to margins).
  const handleUpdateNodePosition = useCallback((nodeId: string, patch: Partial<NonNullable<CanvasNode['position']>>) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, position: { ...(n.position ?? {}), ...patch } } : n)),
    }));
  }, [updateDoc]);

  const handleUpdateCanvas = useCallback((canvas: CanvasRules) => {
    updateDoc((prev) => ({ ...prev, canvas }), 'Canvas settings');
  }, [updateDoc]);

  const handleReviseNode = useCallback((nodeId: string, newContent: CanvasNode['content'], meta?: { source: string; aiInstruction: string }) => {
    // Store revision metadata so the save route can tag the version correctly
    if (meta) {
      lastRevisionMetaRef.current = {
        source: meta.source as RevisionMeta['source'],
        aiInstruction: meta.aiInstruction,
      };
    }
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        // Snapshot the pre-revision content so Revert can restore it (undo the AI edit).
        const prior = JSON.stringify(n.content);
        return {
          ...n,
          content: newContent,
          provenance: { ...n.provenance, source: 'ai_draft' as const, drafted_at: new Date().toISOString() },
          history: [
            ...n.history,
            { actor_id: actorId, actor_name: actorName, action: 'edited' as const, timestamp: new Date().toISOString(), previous_content: prior, comment: 'AI revision' },
          ],
        };
      }),
    }), 'AI revision');
  }, [updateDoc, actorId, actorName]);

  const handleReplaceFromLibrary = useCallback((nodeId: string, atom: LibraryAtomCandidate) => {
    updateDoc((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        if (n.id !== nodeId) return n;
        // Only replace into a node whose content is a single text/code field — preserving
        // its shape. A library atom is prose; blindly writing { text } onto an image / table
        // / chart / list node destroyed its content shape (image lost its storage_key). The
        // Replace button is also hidden for those types (see canReplaceFromLibrary), so this
        // is defense-in-depth: an unsupported type is a no-op, never a corruption.
        const replaced = replaceNodeText(n.content, n.type, atom.content);
        if (replaced === null) return n; // unsupported node type — leave untouched
        return {
          ...n,
          content: replaced,
          provenance: {
            ...n.provenance,
            source: 'library' as const,
            library_unit_id: atom.id,
          },
          history: [
            ...n.history,
            {
              actor_id: actorId,
              actor_name: actorName,
              action: 'replaced' as const,
              timestamp: new Date().toISOString(),
              comment: `Replaced with library atom: ${atom.category}`,
            },
          ],
        };
      }),
    }), 'Replace from library');
  }, [updateDoc, actorId, actorName]);

  /** Insert hand-picked library atoms as new canvas nodes (heading + paragraphs). */
  const handleInsertAtoms = useCallback((atoms: InsertAtom[]) => {
    if (atoms.length === 0) return;
    lastRevisionMetaRef.current = { source: 'library_import', aiInstruction: `Inserted ${atoms.length} atom(s) from library` };
    updateDoc((prev) => {
      const nodes = [...prev.nodes];
      for (const a of atoms) {
        if (a.title) nodes.push(createNode({ type: 'heading', content: { level: 2, text: a.title }, source: 'library', actorId, actorName }));
        for (const para of a.content.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)) {
          nodes.push(createNode({ type: 'text_block', content: { text: para }, source: 'library', actorId, actorName }));
        }
      }
      return { ...prev, nodes };
    }, 'Insert from library');
    setShowInsert(false);
  }, [updateDoc, actorId, actorName]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    setRedoStack(stack => [...stack, { doc, label: entry.label }]);
    setUndoStack(stack => stack.slice(0, -1));
    setDoc(entry.doc);
    setDirty(true);
  }, [undoStack, doc]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1];
    setUndoStack(stack => [...stack, { doc, label: entry.label }]);
    setRedoStack(stack => stack.slice(0, -1));
    setDoc(entry.doc);
    setDirty(true);
  }, [redoStack, doc]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y') && (e.shiftKey || e.key === 'y')) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      // Pass revision metadata alongside the doc so the save route can tag the version
      const meta = lastRevisionMetaRef.current;
      const docWithMeta = meta
        ? Object.assign({}, doc, { __revisionMeta: meta })
        : doc;
      await onSave(docWithMeta);
      setDirty(false);
      // Clear the local recovery draft — the server now has this content.
      try { if (draftKey && typeof window !== 'undefined') window.localStorage.removeItem(draftKey); } catch { /* ignore */ }
      // Clear revision meta after successful save
      lastRevisionMetaRef.current = null;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [doc, onSave, draftKey]);

  // Ctrl/⌘+S saves (a separate effect, after handleSave, to avoid a TDZ reference).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (dirty && !saving) void handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, handleSave]);

  // ── Complete & Lock (finish the ToDo) — save, then POST the section lock
  //    route (admin-gated server-side). On success, refresh so the server
  //    re-renders the now-locked section read-only. ──
  const handleCompleteLock = useCallback(async () => {
    if (!tenantSlug || !proposalId || !sectionId) return;
    setSaving(true); setSaveError(null);
    try {
      if (dirty) await onSave(doc);
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/lock`, { method: 'POST' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Lock failed'); }
      setDirty(false);
      onLocked?.();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Lock failed');
    } finally {
      setSaving(false);
    }
  }, [doc, dirty, onSave, onLocked, tenantSlug, proposalId, sectionId]);

  // ── Save this canvas as a reusable template (skeleton). Admin-gated route. ──
  const handleSaveTemplate = useCallback(async () => {
    if (!tenantSlug) return;
    const name = typeof window !== 'undefined' ? window.prompt('Template name', doc.metadata.title || 'Template') : null;
    if (!name?.trim()) return;
    const fmt = doc.canvas.format;
    const templateType = fmt.startsWith('slide') ? 'slide_deck' : fmt === 'spreadsheet' ? 'cost_volume' : 'custom';
    setSaveError(null);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/templates/extract`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ canvas: doc, name: name.trim(), templateType }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Save template failed'); }
      setSaveError(null);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save template failed');
    }
  }, [doc, tenantSlug]);

  // ── Wire ribbon trigger refs (stable after mount) ─────────────────────
  // These refs let the SectionTopRibbon call editor actions imperatively
  // without threading callbacks through every intermediate component.
  if (triggerSaveRef)   triggerSaveRef.current   = handleSave;
  if (triggerUndoRef)   triggerUndoRef.current   = handleUndo;
  if (triggerRedoRef)   triggerRedoRef.current   = handleRedo;
  if (triggerLockRef)   triggerLockRef.current   = handleCompleteLock;
  if (triggerPanelRef)  triggerPanelRef.current  = () => setSidebarOpen((v) => !v);
  if (triggerExportRef) triggerExportRef.current = (fmt) => {
    if (onExport) onExport(doc, fmt).catch((err) => setSaveError(err instanceof Error ? err.message : 'Export failed'));
  };

  // ── One dispatch the sidebar toolbox cards call for editor-hosted tools. ──
  const handleToolAction = useCallback((id: string) => {
    if (id === 'library') setShowInsert((v) => !v);
    // atomize (harvest locked content to library) and annotate (box-and-tag at ingest/template) both
    // drive the atomization rail. NB: the rail is proposal-scoped today (canAtomize needs
    // proposalId+sectionId), so `annotate` only activates once a dedicated ingest/template curation
    // canvas provides that context — handled here so the card is never inert if such a surface lands.
    else if (id === 'atomize' || id === 'annotate') setShowAtomRail((v) => !v);
    else if (id === 'preview') setPreviewOpen(true);
    else if (id === 'template') handleSaveTemplate();
    else if (id === 'lock') handleCompleteLock();
    else if (id === 'export' && onExport) {
      const fmt = doc.canvas.format.startsWith('slide') ? 'pptx' : doc.canvas.format === 'spreadsheet' ? 'xlsx' : 'docx';
      onExport(doc, fmt).catch((err) => setSaveError(err instanceof Error ? err.message : 'Export failed'));
    }
  }, [doc, onExport, handleSaveTemplate, handleCompleteLock]);

  // ── Atomization rail wiring ──
  const atomItems: AtomBubble[] = useMemo(
    () =>
      doc.nodes
        .filter((n) => n.library_eligible && getNodeText(n).trim().length >= 20)
        .map((n) => ({
          id: n.id,
          heading: nodeHeading(n),
          snippet: getNodeText(n).slice(0, 180),
          nodeType: n.type,
          suggestedType: typeFromLibraryTags(n.library_tags),
          sectionType: typeFromLibraryTags(n.library_tags),
          tags: (n.library_tags ?? []).filter((t) => !t.startsWith('type:')),
          status: acceptedNodeIds.has(n.id) || n.provenance.library_unit_id ? 'approved' : 'draft',
        })),
    [doc.nodes, acceptedNodeIds],
  );

  const railClassify = useCallback(
    (nodeId: string, key: string) => {
      updateDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, library_tags: [...(n.library_tags ?? []).filter((t) => !t.startsWith('type:')), `type:${key}`] }
            : n,
        ),
      }), 'Tag block');
    },
    [updateDoc],
  );

  const railAddTag = useCallback(
    (nodeId: string, tag: string) => {
      const clean = tag.trim();
      if (!clean) return;
      updateDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, library_tags: (n.library_tags ?? []).includes(clean) ? n.library_tags : [...(n.library_tags ?? []), clean] }
            : n,
        ),
      }), 'Add tag');
    },
    [updateDoc],
  );

  const railRemoveTag = useCallback(
    (nodeId: string, tag: string) => {
      updateDoc((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === nodeId ? { ...n, library_tags: (n.library_tags ?? []).filter((t) => t !== tag) } : n,
        ),
      }), 'Remove tag');
    },
    [updateDoc],
  );

  const railAccept = useCallback(
    async (nodeId: string) => {
      if (!tenantSlug || !proposalId || !sectionId) return;
      const node = doc.nodes.find((n) => n.id === nodeId);
      if (!node) return;
      setAtomBusyId(nodeId);
      try {
        const res = await fetch(
          `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/atomize-node`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              nodeId: node.id,
              heading: node.type === 'heading' ? nodeHeading(node) : null,
              text: getNodeText(node),
              sectionType: typeFromLibraryTags(node.library_tags),
              tags: (node.library_tags ?? []).filter((t) => !t.startsWith('type:')),
              parentUnitId: node.provenance.library_unit_id ?? null,
            }),
          },
        );
        if (res.ok) setAcceptedNodeIds((prev) => new Set(prev).add(nodeId));
      } catch {
        // non-critical — surfaced by the bubble staying in draft
      } finally {
        setAtomBusyId(null);
      }
    },
    [tenantSlug, proposalId, sectionId, doc.nodes],
  );

  // ── Selection-as-verb (fluid-canvas F0): act on a highlighted span ──────────
  const [selBusy, setSelBusy] = useState(false);

  /** Atomize a highlighted span → one reusable library atom (lineage from the section). */
  const selectionAtomize = useCallback(async (sel: CanvasSelection) => {
    if (!tenantSlug || !proposalId || !sectionId) return;
    const text = sel.text.trim();
    if (text.length < 20) { toast.info('Select a bit more text to atomize (≥ 20 characters).'); return; }
    setSelBusy(true);
    try {
      const res = await fetch(
        `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/atomize-node`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: sel.nodeIds[0], heading: selectionLabel(sel), text, tags: [] }),
        },
      );
      const j = await res.json().catch(() => ({}));
      if (res.ok) toast.success(j?.data?.deduped ? 'Matched an existing library atom.' : 'Saved as a library atom.');
      else toast.error(j?.error ?? 'Could not atomize the selection.');
    } catch { toast.error('Could not atomize the selection.'); }
    finally { setSelBusy(false); window.getSelection()?.removeAllRanges(); }
  }, [tenantSlug, proposalId, sectionId]);

  /** Regenerate a highlighted span with AI — re-draft it and land it as a reviewable
   *  ai_revision on the first block (Accept/Revert as usual). Reuses proposal.draft_section. */
  const selectionRegenerate = useCallback(async (sel: CanvasSelection) => {
    if (!proposalId) return;
    setSelBusy(true);
    try {
      const res = await fetch('/api/tools/proposal.draft_section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: {
          proposalId,
          sectionTitle: selectionLabel(sel) || 'Selection',
          instruction: `REVISE the following existing text, preserving its intent but improving clarity and specificity:\n\n<user_content>${sel.text}</user_content>`,
          pageLimit: 1,
        } }),
      });
      const j = await res.json().catch(() => ({}));
      const newContent = j?.data?.nodes?.[0]?.content;
      if (res.ok && newContent) {
        handleReviseNode(sel.nodeIds[0], newContent, { source: 'ai_revision', aiInstruction: 'selection regenerate' });
        toast.success('AI revision staged — Accept or Revert on the block.');
      } else {
        toast.error(j?.error ?? 'Could not regenerate the selection.');
      }
    } catch { toast.error('Could not regenerate the selection.'); }
    finally { setSelBusy(false); window.getSelection()?.removeAllRanges(); }
  }, [proposalId, handleReviseNode]);

  /** Annotate a highlighted span — attach a note (comment) to THIS section, quoting the span. */
  const selectionAnnotate = useCallback(async (sel: CanvasSelection) => {
    if (!tenantSlug || !proposalId || !sectionId) return;
    const note = typeof window !== 'undefined' ? window.prompt(`Add a note on “${selectionLabel(sel)}”:`) : null;
    if (!note || !note.trim()) return;
    const snippet = sel.text.slice(0, 140) + (sel.text.length > 140 ? '…' : '');
    setSelBusy(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId: sectionId, text: `“${snippet}” — ${note.trim()}` }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) toast.success('Note added to this section.');
      else toast.error(j?.error ?? 'Could not add the note.');
    } catch { toast.error('Could not add the note.'); }
    finally { setSelBusy(false); window.getSelection()?.removeAllRanges(); }
  }, [tenantSlug, proposalId, sectionId]);

  const railAcceptAll = useCallback(async () => {
    const pending = atomItems.filter((i) => i.status !== 'approved');
    for (const it of pending) {
      // eslint-disable-next-line no-await-in-loop
      await railAccept(it.id);
    }
  }, [atomItems, railAccept]);

  return (
    <div className="flex h-full">
      {/* Canvas area */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {!readOnly && recoverable && (
          <div className="flex items-center justify-between gap-3 bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800">
            <span>You have unsaved changes from a previous session on this page.</span>
            <span className="flex items-center gap-2 shrink-0">
              <button onClick={handleRestoreDraft} className="px-2 py-1 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700">Restore them</button>
              <button onClick={handleDiscardDraft} className="px-2 py-1 text-xs font-medium bg-white border border-amber-300 text-amber-700 rounded hover:bg-amber-100">Discard</button>
            </span>
          </div>
        )}
        {/* Toolbar */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-white border-b px-4 py-2">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-sm text-gray-800 truncate max-w-xs">
              {doc.metadata.title}
            </h2>
            <span className={`text-xs px-2 py-0.5 rounded ${
              doc.metadata.status === 'accepted' ? 'bg-green-100 text-green-700' :
              doc.metadata.status === 'review' ? 'bg-yellow-100 text-yellow-700' :
              doc.metadata.status === 'ai_drafted' ? 'bg-indigo-100 text-indigo-700' :
              'bg-gray-100 text-gray-600'
            }`}>
              {doc.metadata.status.replace('_', ' ')}
            </span>
            {dirty && <span className="text-xs text-orange-500">unsaved</span>}
          </div>
          <div className="flex items-center gap-2">
            {saveError && (
              <span className="text-xs text-red-600 mr-2">{saveError}</span>
            )}
            {onExport && (doc.canvas.format === 'letter' || doc.canvas.format === 'custom') && (
              <>
                <button
                  onClick={async () => {
                    try {
                      await onExport(doc, 'docx');
                    } catch (err) {
                      setSaveError(err instanceof Error ? err.message : 'Export failed');
                    }
                  }}
                  className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
                >
                  Export .docx
                </button>
                <button
                  onClick={async () => {
                    try {
                      await onExport(doc, 'pdf');
                    } catch (err) {
                      setSaveError(err instanceof Error ? err.message : 'Export failed');
                    }
                  }}
                  className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
                  title="Export this section as PDF"
                >
                  Export .pdf
                </button>
              </>
            )}
            {onExport && (doc.canvas.format === 'slide_16_9' || doc.canvas.format === 'slide_4_3') && (
              <button
                onClick={async () => {
                  try {
                    await onExport(doc, 'pptx');
                  } catch (err) {
                    setSaveError(err instanceof Error ? err.message : 'Export failed');
                  }
                }}
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
              >
                Export .pptx
              </button>
            )}
            {onExport && doc.nodes.some((n) => n.type === 'table') && (
              <button
                onClick={async () => {
                  try {
                    await onExport(doc, 'xlsx');
                  } catch (err) {
                    setSaveError(err instanceof Error ? err.message : 'Export failed');
                  }
                }}
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
              >
                Export .xlsx
              </button>
            )}
            {!readOnly && (
              <>
                <button
                  onClick={handleUndo}
                  disabled={undoStack.length === 0}
                  className="px-2 py-1.5 text-xs border rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  title={`Undo (Ctrl+Z) — ${undoStack.length} step${undoStack.length !== 1 ? 's' : ''}`}
                >
                  Undo
                </button>
                <button
                  onClick={handleRedo}
                  disabled={redoStack.length === 0}
                  className="px-2 py-1.5 text-xs border rounded hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed"
                  title={`Redo (Ctrl+Shift+Z) — ${redoStack.length} step${redoStack.length !== 1 ? 's' : ''}`}
                >
                  Redo
                </button>
              </>
            )}
            {canInsertLibrary && (
              <button
                onClick={() => setShowInsert((v) => !v)}
                className={`px-3 py-1.5 text-xs border rounded ${
                  showInsert ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'hover:bg-gray-50'
                }`}
                title="Insert atoms from your library into this section"
              >
                + From Library
              </button>
            )}
            {canAtomize && (
              <button
                onClick={() => setShowAtomRail((v) => !v)}
                className={`px-3 py-1.5 text-xs border rounded ${
                  showAtomRail ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'hover:bg-gray-50'
                }`}
                title="Atomize library-eligible content into your library"
              >
                Library{atomItems.length > 0 ? ` (${atomItems.length})` : ''}
              </button>
            )}
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className={`px-3 py-1.5 text-xs border rounded ${
                sidebarOpen ? 'bg-gray-100 border-gray-300 text-gray-700' : 'hover:bg-gray-50'
              }`}
              title={sidebarOpen ? 'Hide the properties panel (more room for the page)' : 'Show the properties panel'}
            >
              {sidebarOpen ? 'Hide panel' : 'Panel'}
            </button>
            {readOnly ? (
              <span className="px-2 py-1.5 text-xs text-gray-400 italic" title="You have view access to this section">read-only</span>
            ) : (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving || !dirty}
                  className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-medium"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                {capabilities?.canLock && (
                  <button
                    onClick={handleCompleteLock}
                    disabled={saving}
                    title="Save + accept & lock this section (complete the ToDo)"
                    className="px-3 py-1.5 text-xs bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded font-medium"
                  >
                    Complete &amp; Lock
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Formatting toolbar — insert blocks + format the selected one */}
        {!readOnly && (
          <CanvasToolbar
            format={doc.canvas.format}
            selectedNode={selectedNode}
            onAddNode={handleAddNode}
            onUpdateNodeStyle={handleUpdateNodeStyle}
            readOnly={readOnly}
          />
        )}

        {isSlideFormat ? (
          <SlideEditor
            document={doc}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onUpdateNode={handleUpdateNode}
            onAddNode={handleAddNode}
            onDeleteNode={handleDeleteNode}
            onUpdateCanvas={handleUpdateCanvas}
            variables={variables}
            readOnly={readOnly}
          />
        ) : (
          <CanvasRenderer
            document={doc}
            selectedNodeId={selectedNodeId}
            onSelectNode={setSelectedNodeId}
            onUpdateNode={handleUpdateNode}
            variables={variables}
            readOnly={readOnly}
            onMoveNodeToIndex={handleMoveNodeToIndex}
          />
        )}
        {/* Fluid-canvas F0: highlight a span → floating Atomize / Regenerate menu. Only in the
            flow doc renderer (not slide/sheet forks), and only for an editable proposal section. */}
        {!readOnly && doc.canvas.format !== 'spreadsheet' && (proposalId || sectionId) && (
          <SelectionToolbar
            doc={doc}
            busy={selBusy}
            onAtomize={tenantSlug && proposalId && sectionId ? selectionAtomize : undefined}
            onRegenerate={proposalId ? selectionRegenerate : undefined}
            onAnnotate={tenantSlug && proposalId && sectionId ? selectionAnnotate : undefined}
          />
        )}
      </div>

      {/* Insert from library — hand-pick canonical atoms into this section's canvas */}
      {canInsertLibrary && showInsert && tenantSlug && (
        <div className="border border-indigo-200 rounded-lg p-3 bg-white shadow-sm">
          <LibraryInsertPanel
            tenantSlug={tenantSlug}
            sectionTitle={doc.metadata.title || 'Section'}
            sectionId={sectionId}
            onInsert={handleInsertAtoms}
            onClose={() => setShowInsert(false)}
          />
        </div>
      )}

      {/* Atomization rail — accept library-eligible nodes into the tenant library */}
      {canAtomize && showAtomRail && (
        <AtomBubbleRail
          title="Atomize"
          items={atomItems}
          standards={standards}
          onClassify={railClassify}
          onAccept={railAccept}
          onAcceptAll={railAcceptAll}
          onAddTag={railAddTag}
          onRemoveTag={railRemoveTag}
          onBubbleClick={setSelectedNodeId}
          busyId={atomBusyId}
          emptyText="No library-eligible content yet — add sections to atomize."
        />
      )}

      {/* Sidebar — inline column on wide screens, overlay drawer when narrow */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
          <div className="fixed right-0 top-0 bottom-0 z-30 flex shadow-2xl lg:static lg:z-auto lg:shadow-none">
      <CanvasSidebar
        document={doc}
        selectedNode={selectedNode}
        readOnly={readOnly}
        capabilities={capabilities}
        stage={stage}
        onToolAction={handleToolAction}
        onAddNode={handleAddNode}
        onDeleteNode={handleDeleteNode}
        onMoveNode={handleMoveNode}
        onAcceptNode={handleAcceptNode}
        onRevertNode={handleRevertNode}
        onReplaceFromLibrary={handleReplaceFromLibrary}
        onUpdateNodeStyle={handleUpdateNodeStyle}
        onUpdateNodeContent={handleUpdateNode}
        onUpdateNodePosition={handleUpdateNodePosition}
        onUpdateCanvas={handleUpdateCanvas}
        onReviseNode={handleReviseNode}
        proposalId={proposalId}
        tenantSlug={tenantSlug}
        sectionId={sectionId}
      />
          </div>
        </>
      )}

      {previewOpen && (
        <DocumentPreview
          doc={doc}
          proposalId={proposalId}
          tenantSlug={tenantSlug}
          title={doc.metadata.title}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </div>
  );
}
