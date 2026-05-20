'use client';

/**
 * Canvas Editor Sidebar — compliance status, selected node info,
 * history, and library match suggestions.
 */

import { useState, useEffect, useCallback } from 'react';
import type { CanvasDocument, CanvasNode, NodeEdit, NodeStyle, CanvasRules } from '@/lib/types/canvas-document';
import { getNodeText } from '@/lib/types/canvas-document';
import { LibraryPicker, type LibraryAtomCandidate } from './library-picker';
import { AIRevisionPanel } from './ai-revision-panel';
import { CommentThread, type NodeComment } from './collaboration';

interface Props {
  document: CanvasDocument;
  selectedNode: CanvasNode | null;
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
  /** Update canvas-level settings (margins, font, etc.) */
  onUpdateCanvas?: (canvas: CanvasRules) => void;
  /** Handler for AI revision — replaces a node's content with AI-revised text */
  onReviseNode?: (nodeId: string, newContent: CanvasNode['content']) => void;
  /** Proposal ID for AI revision and comments (only available in portal context) */
  proposalId?: string;
  /** Tenant slug for comments API (only available in portal context) */
  tenantSlug?: string;
}

// ─── Self-contained comments section with data fetching ─────────────

function CommentsSection({ nodeId, proposalId, tenantSlug }: { nodeId: string; proposalId: string; tenantSlug: string }) {
  const [comments, setComments] = useState<NodeComment[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/comments?nodeId=${encodeURIComponent(nodeId)}`);
      if (res.ok) {
        const json = await res.json();
        if (json.data) {
          setComments(json.data.map((c: { id: string; userId: string; userName?: string; text: string; createdAt: string; resolved?: boolean }) => ({
            id: c.id,
            actor_id: c.userId,
            actor_name: c.userName ?? 'Unknown',
            text: c.text,
            timestamp: c.createdAt,
            resolved: c.resolved ?? false,
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

  const handleAddComment = useCallback(async (text: string) => {
    try {
      const res = await fetch(`/api/portal/${tenantSlug}/proposals/${proposalId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, text }),
      });
      if (res.ok) {
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
      }
    } catch {
      // swallow
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
        <p className="text-xs text-gray-400 italic mb-2">No comments on this node</p>
      )}
      <CommentThread
        comments={comments}
        onAddComment={handleAddComment}
        onResolve={handleResolve}
      />
    </div>
  );
}

export function CanvasSidebar({
  document: doc,
  selectedNode,
  sectionCategory,
  onAddNode,
  onDeleteNode,
  onMoveNode,
  onAcceptNode,
  onRevertNode,
  onReplaceFromLibrary,
  onUpdateNodeStyle,
  onUpdateCanvas,
  onReviseNode,
  proposalId,
  tenantSlug,
}: Props) {
  const [activeTab, setActiveTab] = useState<'compliance' | 'node' | 'add' | 'settings'>('compliance');
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);

  const pageEstimate = Math.max(1, Math.ceil(doc.nodes.length / 8));
  const maxPages = doc.canvas.max_pages;
  const pageOk = !maxPages || pageEstimate <= maxPages;

  const aiNodes = doc.nodes.filter((n) => n.provenance.source === 'ai_draft').length;
  const libraryNodes = doc.nodes.filter((n) => n.provenance.source === 'library').length;
  const manualNodes = doc.nodes.filter((n) => n.provenance.source === 'manual').length;

  return (
    <div className="w-72 shrink-0 border-l border-gray-200 bg-white overflow-y-auto">
      {/* Tabs */}
      <div className="flex border-b border-gray-200 text-xs">
        {(['compliance', 'node', 'add', 'settings'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
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
                  <span className="font-medium">{doc.metadata.status.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Atoms</span>
                  <span className="font-medium">{doc.nodes.length}</span>
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
                {maxPages && (
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Page limit</span>
                    <span className={`font-medium ${pageOk ? 'text-green-600' : 'text-red-600'}`}>
                      ~{pageEstimate} / {maxPages}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-600">Font</span>
                  <span className="font-medium text-xs">{doc.canvas.font_default.family} {doc.canvas.font_default.size}pt</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Margins</span>
                  <span className="font-medium text-xs">{doc.canvas.margins.left / 72}&quot; all</span>
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
                Selected: {selectedNode.type.replace('_', ' ')}
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Source</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    selectedNode.provenance.source === 'ai_draft' ? 'bg-yellow-100 text-yellow-700' :
                    selectedNode.provenance.source === 'library' ? 'bg-indigo-100 text-indigo-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {selectedNode.provenance.source.replace('_', ' ')}
                  </span>
                </div>
                {selectedNode.provenance.library_unit_id && (
                  <div className="text-xs text-gray-500">
                    From library: {selectedNode.provenance.library_unit_id.slice(0, 8)}...
                  </div>
                )}
                {selectedNode.provenance.source_anchor?.excerpt && (
                  <div className="text-xs text-gray-400 italic mt-1">
                    Source: &ldquo;{selectedNode.provenance.source_anchor.excerpt.slice(0, 80)}...&rdquo;
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-1">
              <button onClick={() => onMoveNode(selectedNode.id, 'up')} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Move Up</button>
              <button onClick={() => onMoveNode(selectedNode.id, 'down')} className="px-2 py-1 text-xs border rounded hover:bg-gray-50">Move Down</button>
              <button onClick={() => onAcceptNode(selectedNode.id)} className="px-2 py-1 text-xs bg-green-50 text-green-700 border border-green-200 rounded hover:bg-green-100">Accept</button>
              <button onClick={() => onRevertNode(selectedNode.id)} className="px-2 py-1 text-xs bg-yellow-50 text-yellow-700 border border-yellow-200 rounded hover:bg-yellow-100">Revert</button>
              <button onClick={() => onDeleteNode(selectedNode.id)} className="px-2 py-1 text-xs bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100">Delete</button>
              {onReplaceFromLibrary && (
                <button
                  onClick={() => setShowLibraryPicker((prev) => !prev)}
                  className="px-2 py-1 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded hover:bg-indigo-100"
                >
                  Replace from Library
                </button>
              )}
            </div>

            {/* Library picker — shown when "Replace from Library" is clicked */}
            {showLibraryPicker && onReplaceFromLibrary && (
              <LibraryPicker
                category={sectionCategory ?? selectedNode.type}
                query={getNodeText(selectedNode).slice(0, 200) || undefined}
                onSelect={(atom) => {
                  onReplaceFromLibrary(selectedNode.id, atom);
                  setShowLibraryPicker(false);
                }}
                onClose={() => setShowLibraryPicker(false)}
              />
            )}

            {/* ── Format ──────────────────────────────────── */}
            {onUpdateNodeStyle && (
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
                    <div className="text-gray-400">{new Date(edit.timestamp).toLocaleString()}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Comments — only in portal context */}
            {proposalId && tenantSlug && (
              <CommentsSection
                nodeId={selectedNode.id}
                proposalId={proposalId}
                tenantSlug={tenantSlug}
              />
            )}

            {/* AI Revision — only for text-bearing nodes in portal context */}
            {onReviseNode && proposalId && (selectedNode.type === 'text_block' || selectedNode.type === 'heading') && (
              <AIRevisionPanel
                node={selectedNode}
                proposalId={proposalId}
                onRevised={(newContent) => onReviseNode(selectedNode.id, newContent)}
              />
            )}
          </>
        )}

        {activeTab === 'node' && !selectedNode && (
          <p className="text-sm text-gray-400 text-center py-8">Click a node on the canvas to see its details</p>
        )}

        {/* ── Add node tab ────────────────────────────────────── */}
        {activeTab === 'add' && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Insert Content</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                { type: 'heading' as const, label: 'Heading', icon: 'H' },
                { type: 'text_block' as const, label: 'Paragraph', icon: 'T' },
                { type: 'bulleted_list' as const, label: 'Bullet List', icon: '•' },
                { type: 'numbered_list' as const, label: 'Numbered List', icon: '#' },
                { type: 'image' as const, label: 'Image', icon: 'img' },
                { type: 'table' as const, label: 'Table', icon: '⊞' },
                { type: 'caption' as const, label: 'Caption', icon: 'C' },
                { type: 'footnote' as const, label: 'Footnote', icon: '†' },
                { type: 'page_break' as const, label: 'Page Break', icon: '—' },
                { type: 'toc' as const, label: 'TOC', icon: '☰' },
                { type: 'url' as const, label: 'Link', icon: '↗' },
                { type: 'spacer' as const, label: 'Spacer', icon: '⎵' },
              ].map((item) => (
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
