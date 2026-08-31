'use client';

/**
 * Canvas Editor Sidebar — compliance status, selected node info,
 * history, and library match suggestions.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { shouldFocusNodeTab } from '@/lib/canvas/format-controls';
import type { CanvasDocument, CanvasNode, NodeEdit, NodeStyle, CanvasRules, NodeType } from '@/lib/types/canvas-document';
import { getNodeText, docNodes } from '@/lib/types/canvas-document';
import { LibraryPicker, type LibraryAtomCandidate } from './library-picker';
import { AIRevisionPanel } from './ai-revision-panel';
import { CommentThread, type NodeComment } from './collaboration';
import { computeSectionBudget, evaluateFit } from '@/lib/section-budget';
import { toolboxFromCapabilities } from '@/lib/canvas/toolbox';
import type { CanvasCapabilities } from '@/lib/canvas/capabilities';
import { canReplaceFromLibrary } from '@/lib/canvas/format-controls';
import { NodeFormatControls } from './node-format-controls';
import { fmtDateTime, fmtNum } from '@/lib/fmt';

/** Every insertable node type, categorized — the single insert surface (the Add tab).
 *  All 22 types are reachable here (was 12; the extended elements were toolbar-only). */
const INSERT_CATEGORIES: ReadonlyArray<{ title: string; items: ReadonlyArray<{ type: NodeType; label: string; icon: string }> }> = [
  { title: 'Text', items: [
    { type: 'heading', label: 'Heading', icon: 'H' },
    { type: 'text_block', label: 'Paragraph', icon: 'T' },
    { type: 'bulleted_list', label: 'Bullet List', icon: '•' },
    { type: 'numbered_list', label: 'Numbered List', icon: '#' },
    { type: 'blockquote', label: 'Quote', icon: '❝' },
    { type: 'url', label: 'Link', icon: '↗' },
    { type: 'caption', label: 'Caption', icon: 'C' },
    { type: 'footnote', label: 'Footnote', icon: '†' },
  ] },
  { title: 'Structure', items: [
    { type: 'table', label: 'Table', icon: '⊞' },
    { type: 'divider', label: 'Divider', icon: '―' },
    { type: 'page_break', label: 'Page Break', icon: '—' },
    { type: 'toc', label: 'Contents', icon: '☰' },
    { type: 'spacer', label: 'Spacer', icon: '⎵' },
  ] },
  { title: 'Media & elements', items: [
    { type: 'image', label: 'Image', icon: '🖼' },
    { type: 'chart', label: 'Chart', icon: '📊' },
    { type: 'shape', label: 'Shape', icon: '▭' },
    { type: 'text_box', label: 'Text box', icon: '⬚' },
    { type: 'callout', label: 'Callout', icon: '❗' },
    { type: 'code_block', label: 'Code', icon: '‹›' },
    { type: 'equation', label: 'Equation', icon: '∑' },
    { type: 'video', label: 'Video', icon: '▶' },
    { type: 'signature', label: 'Signature', icon: '✍' },
  ] },
];

interface Props {
  document: CanvasDocument;
  selectedNode: CanvasNode | null;
  /** View-only (locked proposal, or a comment/view-scoped collaborator) — hides edit affordances. */
  readOnly?: boolean;
  /** Resolved tool set (role × stage) — drives the prioritized toolbox card list. */
  capabilities?: CanvasCapabilities;
  /** Process stage for toolbox ordering ('draft' | 'review' | 'locked' | 'ingest' | 'template'). */
  stage?: string;
  /** Launch an editor-hosted tool from a toolbox card (library/atomize/export/template/lock). */
  onToolAction?: (id: string) => void;
  /** Current section category slug for library search (e.g. 'technical_approach') */
  sectionCategory?: string;
  onAddNode: (type: CanvasNode['type'], after?: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onMoveNode: (nodeId: string, direction: 'up' | 'down') => void;
  onAcceptNode: (nodeId: string) => void;
  onRevertNode: (nodeId: string) => void;
  /** Replace a node's content with a library atom */
  onReplaceFromLibrary?: (nodeId: string, atom: LibraryAtomCandidate) => void;
  /** Update per-node style overrides (alignment, font, spacing, etc.) */
  onUpdateNodeStyle?: (nodeId: string, style: Partial<NodeStyle>) => void;
  /** Update a node's content payload (element-specific props: shape kind, callout variant, chart type, …) */
  onUpdateNodeContent?: (nodeId: string, content: CanvasNode['content']) => void;
  /** Update a node's free placement (position + wrap). */
  onUpdateNodePosition?: (nodeId: string, patch: Partial<NonNullable<CanvasNode['position']>>) => void;
  /** Update canvas-level settings (margins, font, etc.) */
  onUpdateCanvas?: (canvas: CanvasRules) => void;
  /** Handler for AI revision — replaces a node's content with AI-revised text */
  onReviseNode?: (nodeId: string, newContent: CanvasNode['content'], meta?: { source: string; aiInstruction: string }) => void;
  /** Proposal ID for AI revision and comments (only available in portal context) */
  proposalId?: string;
  /** Tenant slug for comments API (only available in portal context) */
  tenantSlug?: string;
  /** Section ID for version history (only available in portal context) */
  sectionId?: string;
}

/**
 * Margins for a read-out: points → inches, 2dp, and "all" only when it is true.
 *
 * Trailing zeros are trimmed so a plain 1" margin reads `1"` rather than `1.00"`, and a slide's
 * 40pt reads `0.56"` rather than the raw `0.5555555555555556` this replaced.
 */
export function marginLabel(m: { top: number; right: number; bottom: number; left: number }): string {
  const inch = (pt: number) => String(Number((pt / 72).toFixed(2)));
  const same = m.top === m.right && m.right === m.bottom && m.bottom === m.left;
  return same
    ? `${inch(m.left)}" all`
    : `${inch(m.top)} · ${inch(m.right)} · ${inch(m.bottom)} · ${inch(m.left)}"`;
}

// ─── Self-contained comments section with data fetching ─────────────

function CommentsSection({ nodeId, proposalId, tenantSlug, canComment = true }: { nodeId: string; proposalId: string; tenantSlug: string; canComment?: boolean }) {
  const [comments, setComments] = useState<NodeComment[]>([]);
  const [postError, setPostError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/comments?nodeId=${encodeURIComponent(nodeId)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setComments(json.data.map((c: { id: string; userId: string; userName?: string; text: string; createdAt: string; resolved?: boolean; recommendationType?: string; category?: string | null; anchor?: { nodeId?: string; quote?: string } | null }) => ({
            id: c.id,
            actor_id: c.userId,
            actor_name: c.userName ?? 'Unknown',
            text: c.text,
            timestamp: c.createdAt,
            resolved: c.resolved ?? false,
            recommendation_type: c.recommendationType,
            category: c.category ?? null,
            anchor: c.anchor ?? null,
          })));
        }
      }
    } catch {
      // swallow fetch errors — comments are non-critical
    } finally {
      setLoading(false);
    }
  }, [nodeId, proposalId, tenantSlug]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  // Re-fetch when a note is pinned from the canvas selection (selectionAnnotate) for THIS section, so an
  // already-open thread shows the new anchored comment without a manual reload.
  useEffect(() => {
    const onAdded = (e: Event) => {
      const d = (e as CustomEvent).detail as { sectionId?: string } | undefined;
      if (!d?.sectionId || d.sectionId === nodeId) fetchComments();
    };
    window.addEventListener('canvas:comment-added', onAdded);
    return () => window.removeEventListener('canvas:comment-added', onAdded);
  }, [fetchComments, nodeId]);

  const handleAddComment = useCallback(async (text: string) => {
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, text }),
      });
      if (res.ok) {
        setPostError(null);
        const json = await res.json();
        if (json.data) {
          setComments((prev) => [...prev, {
            id: json.data.id,
            actor_id: json.data.userId ?? '',
            actor_name: 'You',
            text: json.data.text,
            timestamp: json.data.createdAt,
            resolved: false,
          }]);
        }
      } else {
        // Surface instead of silently dropping the typed comment.
        setPostError('Could not post your comment — you may not have permission to comment on this section.');
      }
    } catch {
      setPostError('Could not post your comment. Please try again.');
    }
  }, [nodeId, proposalId, tenantSlug]);

  const handleResolve = useCallback(async (commentId: string) => {
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/comments/${commentId}/resolve`, {
        method: 'POST',
      });
      if (res.ok) {
        setComments((prev) => prev.map((c) => c.id === commentId ? { ...c, resolved: true } : c));
      }
    } catch {
      // swallow
    }
  }, [proposalId, tenantSlug]);

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Comments</h3>
      {loading && <p className="text-xs text-gray-400">Loading comments...</p>}
      {!loading && comments.length === 0 && (
        <p className="text-xs text-gray-400 italic mb-2">No comments on this section</p>
      )}
      <CommentThread
        comments={comments}
        onAddComment={handleAddComment}
        onResolve={handleResolve}
        canComment={canComment}
      />
      {postError && <p className="text-[11px] text-red-600 mt-1">{postError}</p>}
    </div>
  );
}

// ─── Version History section with data fetching ──────────────────────

interface VersionEntry {
  version_number: number;
  source: string;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  char_count: number | null;
  edit_summary: string | null;
}

function VersionHistorySection({
  proposalId,
  tenantSlug,
  sectionId,
  canRestore,
}: {
  proposalId: string;
  tenantSlug: string;
  sectionId: string;
  canRestore: boolean;
}) {
  const [versions, setVersions] = useState<VersionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [versionContent, setVersionContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const fetchedRef = useRef(false);
  const prevSectionIdRef = useRef(sectionId);

  useEffect(() => {
    if (prevSectionIdRef.current !== sectionId) {
      fetchedRef.current = false;
      prevSectionIdRef.current = sectionId;
    }
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setError(null);
    setVersions([]);
    setSelectedVersion(null);
    setVersionContent(null);
    fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/versions`)
      .then(async (res) => {
        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Failed to load' }));
          setError(json.error || 'Failed to load versions');
          return;
        }
        const json = await res.json();
        setVersions(json.data?.versions ?? []);
      })
      .catch(() => setError('Network error'))
      .finally(() => setLoading(false));
  }, [proposalId, tenantSlug, sectionId]);

  const handleViewVersion = useCallback(
    async (vn: number) => {
      if (selectedVersion === vn) {
        setSelectedVersion(null);
        setVersionContent(null);
        return;
      }
      setSelectedVersion(vn);
      setContentLoading(true);
      try {
        const res = await fetch(
          `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/versions?version=${vn}`,
        );
        if (res.ok) {
          const json = await res.json();
          const content = json.data?.content;
          if (content && typeof content === 'object') {
            const nodes = content.nodes || content;
            if (Array.isArray(nodes)) {
              const parts: string[] = [];
              for (const node of nodes) {
                if (node.content?.text) parts.push(node.content.text);
                else if (typeof node.content === 'string') parts.push(node.content);
              }
              setVersionContent(parts.join('\n\n').slice(0, 2000));
            } else {
              setVersionContent(JSON.stringify(content).slice(0, 2000));
            }
          } else {
            setVersionContent(String(content ?? '').slice(0, 2000));
          }
        }
      } catch {
        setVersionContent('Failed to load content');
      } finally {
        setContentLoading(false);
      }
    },
    [proposalId, tenantSlug, sectionId, selectedVersion],
  );

  const [restoring, setRestoring] = useState<number | null>(null);
  const [restoreErr, setRestoreErr] = useState<string | null>(null);

  const handleRestore = useCallback(
    async (vn: number) => {
      if (!window.confirm(
        `Restore v${vn}? This replaces the current content with this version. ` +
        `The current content is saved to history first, so you can undo this.`,
      )) return;
      setRestoring(vn);
      setRestoreErr(null);
      try {
        const res = await fetch(
          `/api/portal/${tenantSlug}/proposals/${proposalId}/sections/${sectionId}/versions`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionNumber: vn }) },
        );
        if (!res.ok) {
          const json = await res.json().catch(() => ({ error: 'Restore failed' }));
          setRestoreErr(json.error || 'Restore failed');
          setRestoring(null);
          return;
        }
        // Reload so the editor picks up the restored content as the new live version.
        window.location.reload();
      } catch {
        setRestoreErr('Network error');
        setRestoring(null);
      }
    },
    [tenantSlug, proposalId, sectionId],
  );

  const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
    ai_draft: { label: 'AI Draft', color: 'bg-yellow-100 text-yellow-700' },
    human_edit: { label: 'Human Edit', color: 'bg-blue-100 text-blue-700' },
    ai_revision: { label: 'AI Revision', color: 'bg-purple-100 text-purple-700' },
    manual: { label: 'Manual', color: 'bg-green-100 text-green-700' },
    library: { label: 'Library', color: 'bg-indigo-100 text-indigo-700' },
  };

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
        Version History
      </h3>
      {loading && <p className="text-xs text-gray-400">Loading versions...</p>}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!loading && !error && versions.length === 0 && (
        <p className="text-xs text-gray-400 italic">No version history yet</p>
      )}
      {versions.length > 0 && (
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
          {versions.map((v, idx) => {
            const badge = SOURCE_BADGE[v.source] ?? { label: v.source, color: 'bg-gray-100 text-gray-600' };
            const isLatest = idx === 0;
            const isSelected = selectedVersion === v.version_number;
            return (
              <div key={v.version_number}>
                <button
                  onClick={() => handleViewVersion(v.version_number)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs border transition-colors ${
                    isSelected ? 'border-blue-300 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium text-gray-700">v{v.version_number}</span>
                    <div className="flex items-center gap-1">
                      {isLatest && (
                        <span className="px-1 py-0.5 text-[9px] font-semibold bg-emerald-100 text-emerald-600 rounded">
                          Current
                        </span>
                      )}
                      <span className={`px-1 py-0.5 text-[9px] font-medium rounded ${badge.color}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-0.5">
                    {v.created_by_email ?? 'System'}
                    {' -- '}
                    {new Date(v.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {v.char_count != null && ` -- ${fmtNum(v.char_count)} chars`}
                  </div>
                  {v.edit_summary && (
                    <div className="text-[10px] text-gray-500 italic mt-0.5 truncate">
                      {v.edit_summary}
                    </div>
                  )}
                </button>
                {isSelected && (
                  <>
                    <div className="mx-1 mt-1 p-2 bg-gray-50 border border-gray-200 rounded text-[10px] text-gray-600 max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                      {contentLoading ? 'Loading...' : versionContent ?? 'No content'}
                    </div>
                    {canRestore && (
                      <div className="mx-1 mt-1 flex items-center gap-2">
                        <button
                          onClick={() => handleRestore(v.version_number)}
                          disabled={restoring !== null}
                          title="Replace the current content with this version (the current content is archived first, so it stays undoable)"
                          className="px-2 py-1 text-[11px] font-medium bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                        >
                          {restoring === v.version_number ? 'Restoring…' : 'Restore this version'}
                        </button>
                        {restoreErr && <span className="text-[10px] text-red-500">{restoreErr}</span>}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CanvasSidebar({
  document: doc,
  selectedNode,
  readOnly = false,
  capabilities,
  stage,
  onToolAction,
  sectionCategory,
  onAddNode,
  onDeleteNode,
  onMoveNode,
  onAcceptNode,
  onRevertNode,
  onReplaceFromLibrary,
  onUpdateNodeStyle,
  onUpdateNodeContent,
  onUpdateNodePosition,
  onUpdateCanvas,
  onReviseNode,
  proposalId,
  tenantSlug,
  sectionId,
}: Props) {
  const [activeTab, setActiveTab] = useState<'compliance' | 'node' | 'add' | 'history' | 'settings' | 'review'>('compliance');
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);

  // ── SELECTING A NODE LANDS YOU WHERE ITS FORMATTING IS ──────────────────────────────────────
  //
  // The panel opens on `compliance`, and every shape, arrange and layering control lives under
  // `Node`. So the full ribbon was two steps from the page — select, then switch tab — and the
  // capability doc named that as a real friction point rather than a missing feature: the controls
  // were all built, just not where a person looks after clicking something.
  //
  // ONLY FROM THE DEFAULT TAB, which is the whole subtlety. Jumping unconditionally would hijack a
  // deliberate choice: inserting from the `Add` tab selects the node it just inserted, so an
  // unconditional rule would throw the author out of the insert panel on every insert — worse than
  // the friction it fixes. Moving off `compliance` is an expressed preference; sitting on it is
  // not, so only the untouched default gives way.
  // The rule itself is `shouldFocusNodeTab` in lib/canvas/format-controls — a pure predicate, so it
  // is unit-tested rather than only typechecked (vitest runs in `node` here; there is no jsdom).
  const lastSelId = useRef<string | null>(null);
  useEffect(() => {
    const id = selectedNode?.id ?? null;
    if (shouldFocusNodeTab(lastSelId.current, id, activeTab)) setActiveTab('node');
    lastSelId.current = id;
  }, [selectedNode, activeTab]);

  const maxPages = doc.canvas.max_pages;
  // Real word-budget fit (the section "mold") — replaces the old ceil(nodeCount/8) guess.
  const budget = computeSectionBudget({ pageLimit: maxPages, fontSize: doc.canvas.font_default?.size, lineSpacing: doc.canvas.line_spacing });
  // `docNodes`, not `doc.nodes`: a canvas carrying the SECTION layer has no top-level `nodes`, and
  // every read below would throw on it — taking the whole workspace to the error boundary.
  const allNodes = docNodes(doc);
  const fit = evaluateFit(allNodes, budget);
  const pageOk = fit.withinBudget;

  const aiNodes = allNodes.filter((n) => n.provenance?.source === 'ai_draft').length;
  const libraryNodes = allNodes.filter((n) => n.provenance?.source === 'library').length;
  const manualNodes = allNodes.filter((n) => n.provenance?.source === 'manual').length;

  // Role/lock gates the EDIT tabs (Add blocks, page Settings) — a view/comment
  // user keeps the read panels (status, node info, history, comments).
  const hasComments = Boolean(proposalId && tenantSlug && sectionId);
  const tabs = [
    'compliance' as const,
    'node' as const,
    ...(!readOnly ? ['add' as const] : []),
    ...(hasComments ? ['review' as const] : []),
    ...(hasComments ? ['history' as const] : []),
    ...(!readOnly ? ['settings' as const] : []),
  ];

  // The prioritized toolbox for this role×context — most-likely card first.
  const toolbox = capabilities ? toolboxFromCapabilities(capabilities, stage ?? (readOnly ? 'review' : 'draft')) : null;
  // ai → the Node tab (home of AIRevisionPanel); format → Node; floorplan → Settings (page layout).
  const CARD_TAB: Partial<Record<string, typeof activeTab>> = { compliance: 'compliance', insert: 'add', format: 'node', floorplan: 'settings', review: 'review', ai: 'node' };
  const ACTION_CARDS = new Set(['library', 'atomize', 'export', 'template', 'lock', 'preview']);
  // A card is renderable only if it actually routes somewhere (a tab or a handled action).
  // Anything else (e.g. `sections`, which has no view yet) is filtered out rather than shown
  // as a dead/disabled button — the toolbox only ever offers tools that work.
  const cardIsActionable = (id: string) => {
    const tab = CARD_TAB[id];
    return (!!tab && tabs.includes(tab)) || (ACTION_CARDS.has(id) && !!onToolAction);
  };

  return (
    <div className="w-72 shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
      {/* Toolbox — the role×context card list (most-likely tool on top). */}
      {toolbox && toolbox.cards.some((c) => cardIsActionable(c.id)) && (
        <div className="border-b border-gray-200 bg-gray-50/60 px-3 py-2">
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Your toolbox</div>
          <div className="space-y-1">
            {toolbox.cards.filter((c) => cardIsActionable(c.id)).map((c) => {
              const tab = CARD_TAB[c.id];
              const isPrimary = toolbox.primary?.id === c.id;
              const toTab = tab && tabs.includes(tab);
              return (
                <button
                  key={c.id}
                  onClick={() => (toTab ? setActiveTab(tab!) : onToolAction?.(c.id))}
                  title={c.hint}
                  className={`w-full text-left flex items-start gap-1.5 rounded px-2 py-1 text-xs transition-colors cursor-pointer ${
                    isPrimary ? 'bg-blue-50 border border-blue-200' : c.ambient ? 'text-gray-400' : 'hover:bg-white border border-transparent'
                  }`}
                >
                  <span className={isPrimary ? 'text-blue-500' : 'text-gray-300'}>{isPrimary ? '★' : '·'}</span>
                  <span className="flex-1 min-w-0">
                    <span className={`font-medium ${isPrimary ? 'text-blue-700' : c.ambient ? 'text-gray-400' : 'text-gray-700'}`}>{c.title}</span>
                    {isPrimary && <span className="block text-[10px] text-gray-400 truncate">{c.hint}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-200 text-xs">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as typeof activeTab)}
            className={`flex-1 py-2.5 font-medium capitalize ${
              activeTab === tab ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab === 'node' ? (selectedNode ? 'Node' : 'Select') : tab}
          </button>
        ))}
      </div>

      <div className="p-4 space-y-4">
        {/* ── Compliance tab ──────────────────────────────────── */}
        {activeTab === 'compliance' && (
          <>
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Document Status</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Status</span>
                  {/* B78 class, third occurrence: an unguarded read of a stored canvas field takes
                      the ENTIRE section workspace to the route error boundary — status 200, no
                      server log, nothing rendered. `metadata.status` and `nodes` are both typed
                      required and both absent from real shapes the product can produce (a canvas
                      carrying the section layer has no top-level `nodes` at all). No stored row
                      violates either today; the guard costs nothing and the failure mode is a
                      white screen on a customer's proposal. */}
                  <span className="font-medium">{(doc.metadata?.status ?? 'draft').replace(/_/g, ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Atoms</span>
                  <span className="font-medium">{allNodes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Version</span>
                  <span className="font-medium">v{doc.metadata.version_number}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Compliance</h3>
              <div className="space-y-2 text-sm">
                {budget && (
                  <div className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">Length</span>
                      <span className={`font-medium ${pageOk ? 'text-green-600' : 'text-red-600'}`}>
                        {fit.words} / {budget.maxWords} words
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pageOk ? 'bg-green-500' : 'bg-red-500'}`}
                           style={{ width: `${Math.min(100, Math.round((fit.fill ?? 0) * 100))}%` }} />
                    </div>
                    <div className="text-[10px] text-gray-400">
                      {maxPages}-page limit · ~{budget.targetWords}-word target{pageOk ? '' : ' · OVER budget'}
                    </div>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600">Font</span>
                  <span className="font-medium text-xs">{doc.canvas.font_default.family} {doc.canvas.font_default.size}pt</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Margins</span>
                  {/* Rounded, and honest about "all".
                      Margins are stored in POINTS; a 40pt slide margin divided by 72 rendered as
                      `0.5555555555555556" all` — a raw float in a customer-facing read-out, next to
                      a claim that was also wrong whenever the four sides differ. Two decimals is the
                      precision an inches control with a 0.25 step can express; "all" now appears
                      only when the four sides really are equal. */}
                  <span className="font-medium text-xs">{marginLabel(doc.canvas.margins)}</span>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Content Sources</h3>
              <div className="space-y-1 text-sm">
                {aiNodes > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-yellow-400 rounded-full" />
                    <span className="text-gray-600">{aiNodes} AI drafted</span>
                  </div>
                )}
                {libraryNodes > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-indigo-400 rounded-full" />
                    <span className="text-gray-600">{libraryNodes} from library</span>
                  </div>
                )}
                {manualNodes > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-green-400 rounded-full" />
                    <span className="text-gray-600">{manualNodes} manual</span>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Node detail tab ─────────────────────────────────── */}
        {activeTab === 'node' && selectedNode && (
          <>
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                Selected: {selectedNode.type.replace(/_/g, ' ')}
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Source</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    selectedNode.provenance?.source === 'ai_draft' ? 'bg-yellow-100 text-yellow-700' :
                    selectedNode.provenance?.source === 'library' ? 'bg-indigo-100 text-indigo-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {selectedNode.provenance?.source.replace(/_/g, ' ')}
                  </span>
                </div>
                {selectedNode.provenance?.library_unit_id && (
                  <div className="text-xs text-gray-500">
                    From library: {selectedNode.provenance?.library_unit_id.slice(0, 8)}...
                  </div>
                )}
                {selectedNode.provenance?.source_anchor?.excerpt && (
                  <div className="text-xs text-gray-400 italic mt-1">
                    Source: &ldquo;{selectedNode.provenance?.source_anchor.excerpt.slice(0, 80)}...&rdquo;
                  </div>
                )}
              </div>
            </div>

            {!readOnly && (
              <div className="flex flex-wrap gap-1">
                <button onClick={() => onMoveNode(selectedNode.id, 'up')} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Move Up</button>
                <button onClick={() => onMoveNode(selectedNode.id, 'down')} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Move Down</button>
                {selectedNode.provenance?.source === 'ai_draft' && (
                  <>
                    <button onClick={() => onAcceptNode(selectedNode.id)} title="Keep this AI content" className="px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100">Accept</button>
                    {selectedNode.history.some((h) => h.previous_content != null) && (
                      <button onClick={() => onRevertNode(selectedNode.id)} title="Undo the AI revision — restore your previous content" className="px-2 py-1 text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 rounded hover:bg-yellow-100">Revert</button>
                    )}
                  </>
                )}
                <button onClick={() => onDeleteNode(selectedNode.id)} className="px-2 py-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100">Delete</button>
                {onReplaceFromLibrary && canReplaceFromLibrary(selectedNode.type) && (
                  <button
                    onClick={() => setShowLibraryPicker((prev) => !prev)}
                    className="px-2 py-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100"
                  >
                    Replace from Library
                  </button>
                )}
              </div>
            )}

            {/* Library picker — shown when "Replace from Library" is clicked (text nodes only) */}
            {showLibraryPicker && onReplaceFromLibrary && canReplaceFromLibrary(selectedNode.type) && (
              <LibraryPicker
                category={sectionCategory ?? selectedNode.type}
                query={getNodeText(selectedNode).slice(0, 200) || undefined}
                tenantSlug={tenantSlug}
                sectionId={sectionId}
                proposalId={proposalId}
                onSelect={(atom) => {
                  onReplaceFromLibrary(selectedNode.id, atom);
                  setShowLibraryPicker(false);
                }}
                onClose={() => setShowLibraryPicker(false)}
              />
            )}

            {/* ── Format ──────────────────────────────────── */}
            {!readOnly && onUpdateNodeStyle && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Format</h3>

                {/* Alignment — 4 buttons in a row */}
                <div className="mb-3">
                  <label className="text-[10px] text-gray-400 block mb-1">Alignment</label>
                  <div className="flex gap-0.5">
                    {(['left', 'center', 'right', 'justify'] as const).map(align => (
                      <button
                        key={align}
                        onClick={() => onUpdateNodeStyle(selectedNode.id, { alignment: align })}
                        className={`flex-1 py-1 text-xs border rounded capitalize ${
                          selectedNode.style.alignment === align
                            ? 'bg-blue-100 border-blue-300 text-blue-700'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        {align === 'left' ? '←' : align === 'right' ? '→' : align === 'center' ? '↔' : '⇔'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Font family + size — side by side */}
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Font</label>
                    <select
                      value={selectedNode.style.family ?? ''}
                      onChange={(e) => onUpdateNodeStyle(selectedNode.id, { family: e.target.value || undefined })}
                      className="w-full text-xs border rounded px-1.5 py-1"
                    >
                      <option value="">Default</option>
                      <option value="Times New Roman">Times New Roman</option>
                      <option value="Arial">Arial</option>
                      <option value="Calibri">Calibri</option>
                      <option value="Georgia">Georgia</option>
                      <option value="Helvetica">Helvetica</option>
                      <option value="Courier New">Courier New</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Size</label>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="6"
                        max="72"
                        step="1"
                        value={selectedNode.style.size ?? ''}
                        onChange={(e) => onUpdateNodeStyle(selectedNode.id, {
                          size: e.target.value ? parseInt(e.target.value) : undefined
                        })}
                        placeholder="--"
                        className="w-full text-xs border rounded px-1.5 py-1"
                      />
                      <span className="text-[10px] text-gray-400">pt</span>
                    </div>
                  </div>
                </div>

                {/* Bold + Italic toggles */}
                <div className="mb-3">
                  <label className="text-[10px] text-gray-400 block mb-1">Style</label>
                  <div className="flex gap-1">
                    <button
                      onClick={() => onUpdateNodeStyle(selectedNode.id, {
                        weight: selectedNode.style.weight === 'bold' ? 'normal' : 'bold'
                      })}
                      className={`px-3 py-1 text-xs font-bold border rounded ${
                        selectedNode.style.weight === 'bold' ? 'bg-blue-100 border-blue-300' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >B</button>
                    <button
                      onClick={() => onUpdateNodeStyle(selectedNode.id, {
                        style: selectedNode.style.style === 'italic' ? 'normal' : 'italic'
                      })}
                      className={`px-3 py-1 text-xs italic border rounded ${
                        selectedNode.style.style === 'italic' ? 'bg-blue-100 border-blue-300' : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >I</button>
                  </div>
                </div>

                {/* Text color */}
                <div className="mb-3">
                  <label className="text-[10px] text-gray-400 block mb-1">Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={selectedNode.style.color || '#000000'}
                      onChange={(e) => onUpdateNodeStyle(selectedNode.id, { color: e.target.value })}
                      className="w-6 h-6 border rounded cursor-pointer"
                    />
                    <span className="text-[10px] text-gray-500">{selectedNode.style.color || 'default'}</span>
                    {selectedNode.style.color && (
                      <button
                        onClick={() => onUpdateNodeStyle(selectedNode.id, { color: undefined })}
                        className="text-[10px] text-red-500 hover:underline"
                      >reset</button>
                    )}
                  </div>
                </div>

                {/* Spacing */}
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Space Before</label>
                    <input
                      type="number"
                      min="0"
                      max="72"
                      step="2"
                      value={selectedNode.style.space_before ?? ''}
                      onChange={(e) => onUpdateNodeStyle(selectedNode.id, {
                        space_before: e.target.value ? parseInt(e.target.value) : undefined
                      })}
                      placeholder="auto"
                      className="w-full text-xs border rounded px-1.5 py-1"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400 block mb-1">Space After</label>
                    <input
                      type="number"
                      min="0"
                      max="72"
                      step="2"
                      value={selectedNode.style.space_after ?? ''}
                      onChange={(e) => onUpdateNodeStyle(selectedNode.id, {
                        space_after: e.target.value ? parseInt(e.target.value) : undefined
                      })}
                      placeholder="auto"
                      className="w-full text-xs border rounded px-1.5 py-1"
                    />
                  </div>
                </div>

                {/* Indent */}
                <div className="mb-3">
                  <label className="text-[10px] text-gray-400 block mb-1">Indent (px)</label>
                  <input
                    type="number"
                    min="0"
                    max="200"
                    step="20"
                    value={selectedNode.style.indent ?? ''}
                    onChange={(e) => onUpdateNodeStyle(selectedNode.id, {
                      indent: e.target.value ? parseInt(e.target.value) : undefined
                    })}
                    placeholder="0"
                    className="w-full text-xs border rounded px-1.5 py-1"
                  />
                </div>

                {/* Context-aware ribbon groups: emphasis (U/S/highlight) · Shape
                    Format (fill/border/opacity/rotation/shadow) · Arrange (free
                    placement) · the element-specific control. Shown only for the
                    node types that support each group. */}
                <NodeFormatControls
                  node={selectedNode}
                  readOnly={readOnly}
                  onStyle={(patch) => onUpdateNodeStyle(selectedNode.id, patch)}
                  onContent={(content) => onUpdateNodeContent?.(selectedNode.id, content)}
                  onPosition={(patch) => onUpdateNodePosition?.(selectedNode.id, patch)}
                />
              </div>
            )}

            {selectedNode.library_tags && selectedNode.library_tags.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Library Tags</h3>
                <div className="flex flex-wrap gap-1">
                  {selectedNode.library_tags.map((tag) => (
                    <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{tag}</span>
                  ))}
                </div>
              </div>
            )}

            {/* History */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">History</h3>
              <div className="space-y-2">
                {selectedNode.history.map((edit, i) => (
                  <div key={i} className="text-xs border-l-2 border-blue-200 pl-2 py-0.5">
                    <div className="text-gray-700">
                      <span className="font-medium">{edit.actor_name}</span> {edit.action}
                    </div>
                    {edit.comment && <div className="text-gray-400 italic">{edit.comment}</div>}
                    <div className="text-gray-400">{fmtDateTime(edit.timestamp)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Comments — section-scoped (proposal_comments keys on section_id).
                Previously passed the canvas node id, which the API validated as a
                section id → every read was empty and every post 404'd. */}
            {proposalId && tenantSlug && sectionId && (
              <CommentsSection
                nodeId={sectionId}
                proposalId={proposalId}
                tenantSlug={tenantSlug}
                canComment={capabilities?.canComment ?? true}
              />
            )}

            {/* AI Revision — only for text-bearing nodes in portal context, and
                only when the resolved capabilities allow AI drafting (the
                proposal.draft_section tool requires tenant_user; a partner
                without the grant would see buttons that 403). */}
            {onReviseNode && proposalId && (capabilities?.canDraftAI ?? true) && (selectedNode.type === 'text_block' || selectedNode.type === 'heading') && (
              <AIRevisionPanel
                node={selectedNode}
                proposalId={proposalId}
                onRevised={(newContent, meta) => onReviseNode(selectedNode.id, newContent, meta)}
              />
            )}
          </>
        )}

        {activeTab === 'node' && !selectedNode && (
          <p className="text-sm text-gray-400 text-center py-8">Click a node on the canvas to see its details</p>
        )}

        {/* ── Add node tab — the ONE comprehensive insert surface: every insertable
              node type, categorized (was 12 of 22 here, the extended elements only on
              the toolbar — a user hunting for "Chart" never found it). ── */}
        {activeTab === 'add' && (
          <div className="space-y-4">
            {INSERT_CATEGORIES.map((cat) => (
              <div key={cat.title}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{cat.title}</h3>
                <div className="grid grid-cols-2 gap-2">
                  {cat.items.map((item) => (
                    <button
                      key={item.type}
                      onClick={() => onAddNode(item.type, selectedNode?.id)}
                      className="flex items-center gap-2 px-3 py-2 text-xs border rounded hover:bg-blue-50 hover:border-blue-200 text-left"
                    >
                      <span className="w-5 text-center font-bold text-gray-400">{item.icon}</span>
                      <span className="text-gray-700">{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Review tab — the collaboration workbench: comment · revise · complete ── */}
        {activeTab === 'review' && proposalId && tenantSlug && sectionId && (
          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Review · Modify · Lock</h3>
              <p className="text-[11px] text-gray-400">
                {readOnly ? 'You have review access — comment below.' : 'Comment, revise on the canvas, then complete this section.'}
              </p>
            </div>
            {capabilities?.canLock ? (
              <button
                onClick={() => onToolAction?.('lock')}
                className="w-full text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-2"
                title="Save + accept & lock this section (complete the ToDo)"
              >
                Complete &amp; Lock this section
              </button>
            ) : !readOnly ? (
              <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
                Save your edits — an admin accepts &amp; locks the section to complete it.
              </p>
            ) : null}
            <CommentsSection nodeId={sectionId} proposalId={proposalId} tenantSlug={tenantSlug} canComment={capabilities?.canComment ?? true} />
          </div>
        )}

        {/* ── History tab ────────────────────────────────────── */}
        {activeTab === 'history' && proposalId && tenantSlug && sectionId && (
          <VersionHistorySection
            proposalId={proposalId}
            tenantSlug={tenantSlug}
            sectionId={sectionId}
            canRestore={!readOnly}
          />
        )}

        {/* ── Settings tab ───────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Page Layout</h3>

            {/* Margins */}
            <div>
              <label className="text-xs text-gray-600 block mb-1">Margins (inches)</label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-gray-400">Top</label>
                  <input type="number" step="0.25" min="0" max="3"
                    value={doc.canvas.margins.top / 72}
                    onChange={(e) => onUpdateCanvas?.({
                      ...doc.canvas,
                      margins: { ...doc.canvas.margins, top: parseFloat(e.target.value) * 72 }
                    })}
                    className="w-full text-xs border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400">Bottom</label>
                  <input type="number" step="0.25" min="0" max="3"
                    value={doc.canvas.margins.bottom / 72}
                    onChange={(e) => onUpdateCanvas?.({
                      ...doc.canvas,
                      margins: { ...doc.canvas.margins, bottom: parseFloat(e.target.value) * 72 }
                    })}
                    className="w-full text-xs border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400">Left</label>
                  <input type="number" step="0.25" min="0" max="3"
                    value={doc.canvas.margins.left / 72}
                    onChange={(e) => onUpdateCanvas?.({
                      ...doc.canvas,
                      margins: { ...doc.canvas.margins, left: parseFloat(e.target.value) * 72 }
                    })}
                    className="w-full text-xs border rounded px-2 py-1" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400">Right</label>
                  <input type="number" step="0.25" min="0" max="3"
                    value={doc.canvas.margins.right / 72}
                    onChange={(e) => onUpdateCanvas?.({
                      ...doc.canvas,
                      margins: { ...doc.canvas.margins, right: parseFloat(e.target.value) * 72 }
                    })}
                    className="w-full text-xs border rounded px-2 py-1" />
                </div>
              </div>
            </div>

            {/* Font */}
            <div>
              <label className="text-xs text-gray-600 block mb-1">Default Font</label>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={doc.canvas.font_default.family}
                  onChange={(e) => onUpdateCanvas?.({
                    ...doc.canvas,
                    font_default: { ...doc.canvas.font_default, family: e.target.value }
                  })}
                  className="text-xs border rounded px-2 py-1">
                  <option value="Times New Roman">Times New Roman</option>
                  <option value="Arial">Arial</option>
                  <option value="Calibri">Calibri</option>
                  <option value="Georgia">Georgia</option>
                  <option value="Helvetica">Helvetica</option>
                  <option value="Courier New">Courier New</option>
                </select>
                <div className="flex items-center gap-1">
                  <input type="number" step="1" min="6" max="24"
                    value={doc.canvas.font_default.size}
                    onChange={(e) => onUpdateCanvas?.({
                      ...doc.canvas,
                      font_default: { ...doc.canvas.font_default, size: parseInt(e.target.value) || 12 }
                    })}
                    className="w-16 text-xs border rounded px-2 py-1" />
                  <span className="text-xs text-gray-400">pt</span>
                </div>
              </div>
            </div>

            {/* Line Spacing */}
            <div>
              <label className="text-xs text-gray-600 block mb-1">Line Spacing</label>
              <select
                value={doc.canvas.line_spacing}
                onChange={(e) => onUpdateCanvas?.({
                  ...doc.canvas,
                  line_spacing: parseFloat(e.target.value)
                })}
                className="w-full text-xs border rounded px-2 py-1">
                <option value="1.0">Single (1.0)</option>
                <option value="1.15">1.15</option>
                <option value="1.5">1.5</option>
                <option value="2.0">Double (2.0)</option>
              </select>
            </div>

            {/* Page/Slide Limit */}
            <div>
              <label className="text-xs text-gray-600 block mb-1">
                {doc.canvas.format.startsWith('slide') ? 'Slide Limit' : 'Page Limit'}
              </label>
              <div className="flex items-center gap-2">
                <input type="number" min="0" max="999"
                  value={doc.canvas.format.startsWith('slide') ? (doc.canvas.max_slides ?? 0) : (doc.canvas.max_pages ?? 0)}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    if (doc.canvas.format.startsWith('slide')) {
                      onUpdateCanvas?.({ ...doc.canvas, max_slides: val || null });
                    } else {
                      onUpdateCanvas?.({ ...doc.canvas, max_pages: val || null });
                    }
                  }}
                  className="w-20 text-xs border rounded px-2 py-1" />
                <span className="text-xs text-gray-400">(0 = unlimited)</span>
              </div>
            </div>

            {/* Header */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-600">Header</label>
                {!doc.canvas.header ? (
                  <button
                    onClick={() => onUpdateCanvas?.({
                      ...doc.canvas,
                      header: { template: '{company_name}', height: 36, font: { family: doc.canvas.font_default.family, size: 10 } }
                    })}
                    className="text-[10px] text-blue-600 hover:underline">+ Add header</button>
                ) : (
                  <button
                    onClick={() => onUpdateCanvas?.({ ...doc.canvas, header: null })}
                    className="text-[10px] text-red-500 hover:underline">Remove</button>
                )}
              </div>
              {doc.canvas.header && (
                <input type="text"
                  value={doc.canvas.header.template}
                  onChange={(e) => onUpdateCanvas?.({
                    ...doc.canvas,
                    header: { ...doc.canvas.header!, template: e.target.value }
                  })}
                  placeholder="e.g. {company_name} — {topic_number}"
                  className="w-full text-xs border rounded px-2 py-1" />
              )}
            </div>

            {/* Footer */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-600">Footer</label>
                {!doc.canvas.footer ? (
                  <button
                    onClick={() => onUpdateCanvas?.({
                      ...doc.canvas,
                      footer: { template: 'Page {n} of {N}', height: 36, font: { family: doc.canvas.font_default.family, size: 10 } }
                    })}
                    className="text-[10px] text-blue-600 hover:underline">+ Add footer</button>
                ) : (
                  <button
                    onClick={() => onUpdateCanvas?.({ ...doc.canvas, footer: null })}
                    className="text-[10px] text-red-500 hover:underline">Remove</button>
                )}
              </div>
              {doc.canvas.footer && (
                <input type="text"
                  value={doc.canvas.footer.template}
                  onChange={(e) => onUpdateCanvas?.({
                    ...doc.canvas,
                    footer: { ...doc.canvas.footer!, template: e.target.value }
                  })}
                  placeholder="e.g. Page {n} of {N}"
                  className="w-full text-xs border rounded px-2 py-1" />
              )}
            </div>

            <div className="text-[10px] text-gray-400 pt-2 border-t">
              Variables: {'{company_name}'}, {'{topic_number}'}, {'{pi_name}'}, {'{n}'} (page), {'{N}'} (total)
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
