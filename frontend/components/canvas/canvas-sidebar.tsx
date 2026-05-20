'use client';

/**
 * Canvas Editor Sidebar — compliance status, selected node info,
 * history, and library match suggestions.
 */

import { useState } from 'react';
import type { CanvasDocument, CanvasNode, NodeEdit, CanvasRules } from '@/lib/types/canvas-document';
import { getNodeText } from '@/lib/types/canvas-document';
import { LibraryPicker, type LibraryAtomCandidate } from './library-picker';

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
  /** Update canvas-level settings (margins, font, etc.) */
  onUpdateCanvas?: (canvas: CanvasRules) => void;
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
  onUpdateCanvas,
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
                { type: 'image' as const, label: 'Image', icon: '🖼' },
                { type: 'table' as const, label: 'Table', icon: '⊞' },
                { type: 'caption' as const, label: 'Caption', icon: 'C' },
                { type: 'footnote' as const, label: 'Footnote', icon: '†' },
                { type: 'page_break' as const, label: 'Page Break', icon: '—' },
                { type: 'toc' as const, label: 'TOC', icon: '☰' },
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
